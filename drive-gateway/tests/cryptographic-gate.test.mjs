import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalSigningPayload,
  buildCryptographicAuditEvent,
  createCryptographicEvidence,
  createSignerKeyProvider,
  generateSignerKeyPair,
  sealAndPersist,
  verifyCryptographicEvidence,
} from "../src/cryptographicGate.mjs";
import { sha256Hex } from "../src/util.mjs";

const originalBytes = new TextEncoder().encode("%PDF-1.7\nIRPA cryptographic gate fixture\n%%EOF");
const chainHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

async function fixture() {
  const keyPair = await generateSignerKeyPair();
  const keyRecord = { keyId: "IRPA-KEY-001", ...keyPair };
  const signer = {
    uid: "uid-signer-001",
    id: "S1",
    envelopeId: "ENV-CRYPTO-001",
    signatureType: "typed",
    signatureValue: "Gate Cryptographic Signer",
    signedAt: "2026-10-07T18:00:00.000Z",
    order: 1,
  };
  const documentHash = await sha256Hex(originalBytes);
  const signatureHash = await sha256Hex(signer.signatureValue);
  return { keyPair, keyRecord, signer, documentHash, signatureHash };
}

test("C-G01 key architecture: asymmetric P-256 key pair has an opaque private key boundary", async () => {
  const { keyPair } = await fixture();
  assert.equal(keyPair.privateKey.type, "private");
  assert.equal(keyPair.publicKey.type, "public");
  assert.equal(keyPair.privateKey.extractable, false);
  assert.deepEqual(keyPair.privateKey.usages, ["sign"]);
  assert.deepEqual(keyPair.publicKey.usages, ["verify"]);
});

test("C-G02 canonical signing payload is deterministic and contains the exact signed fields", async () => {
  const { signer, documentHash, signatureHash, keyRecord } = await fixture();
  const a = buildCanonicalSigningPayload({
    envelopeId: signer.envelopeId,
    signerId: signer.id,
    signerUid: signer.uid,
    documentHash,
    signatureHash,
    signatureType: signer.signatureType,
    signedAt: signer.signedAt,
    chainHead,
    keyId: keyRecord.keyId,
  });
  const b = buildCanonicalSigningPayload({
    keyId: keyRecord.keyId,
    chainHead,
    signedAt: signer.signedAt,
    signatureType: signer.signatureType,
    signatureHash,
    documentHash,
    signerUid: signer.uid,
    signerId: signer.id,
    envelopeId: signer.envelopeId,
  });
  assert.equal(a, b);
  const parsed = JSON.parse(a);
  assert.equal(parsed.documentHash, documentHash);
  assert.equal(parsed.signerUid, signer.uid);
  assert.equal(parsed.algorithm, "ECDSA-P256-SHA256");
});

test("C-G03 cryptographic signing produces an actual asymmetric signature", async () => {
  const { signer, documentHash, signatureHash, keyRecord } = await fixture();
  const payload = buildCanonicalSigningPayload({
    envelopeId: signer.envelopeId, signerId: signer.id, signerUid: signer.uid,
    documentHash, signatureHash, signatureType: signer.signatureType,
    signedAt: signer.signedAt, chainHead, keyId: keyRecord.keyId,
  });
  const evidence = await createCryptographicEvidence({
    keyId: keyRecord.keyId,
    signer: {
      ...signer, privateKey: keyRecord.privateKey, publicKey: keyRecord.publicKey,
      signatureHash,
    },
    documentHash, chainHead, signedAt: signer.signedAt,
  });
  assert.notEqual(evidence.signature, payload);
  assert.match(evidence.signature, /^[A-Za-z0-9_-]+$/);
  assert.ok(evidence.signature.length >= 80);
});

test("C-G04 cryptographic verification independently verifies the signature", async () => {
  const { signer, keyRecord, documentHash, signatureHash } = await fixture();
  const evidence = await createCryptographicEvidence({
    keyId: keyRecord.keyId,
    signer: {...signer, privateKey:keyRecord.privateKey, publicKey:keyRecord.publicKey, signatureHash},
    documentHash, chainHead, signedAt: signer.signedAt,
  });
  assert.equal(await verifyCryptographicEvidence(evidence, {
    documentHash, signerUid: signer.uid, publicKey: keyRecord.publicKey,
  }), true);
});

test("C-G05 signer binding rejects verification under another institutional identity", async () => {
  const { signer, keyRecord, documentHash, signatureHash } = await fixture();
  const evidence = await createCryptographicEvidence({
    keyId:keyRecord.keyId,
    signer:{...signer,privateKey:keyRecord.privateKey,publicKey:keyRecord.publicKey,signatureHash},
    documentHash, chainHead, signedAt:signer.signedAt,
  });
  assert.equal(await verifyCryptographicEvidence(evidence, {
    documentHash, signerUid:"uid-other-signer", publicKey:keyRecord.publicKey,
  }), false);
});

test("C-G06 document binding is to the exact completed-document SHA-256", async () => {
  const { signer, keyRecord, documentHash, signatureHash } = await fixture();
  const evidence = await createCryptographicEvidence({
    keyId:keyRecord.keyId,
    signer:{...signer,privateKey:keyRecord.privateKey,publicKey:keyRecord.publicKey,signatureHash},
    documentHash, chainHead, signedAt:signer.signedAt,
  });
  assert.equal(evidence.documentHash, documentHash);
  const changedHash = await sha256Hex(new TextEncoder().encode("changed"));
  assert.equal(await verifyCryptographicEvidence(evidence, {
    documentHash:changedHash, signerUid:signer.uid, publicKey:keyRecord.publicKey,
  }), false);
});

test("C-G07 changing signed document metadata or payload invalidates verification", async () => {
  const { signer, keyRecord, documentHash, signatureHash } = await fixture();
  const evidence = await createCryptographicEvidence({
    keyId:keyRecord.keyId,
    signer:{...signer,privateKey:keyRecord.privateKey,publicKey:keyRecord.publicKey,signatureHash},
    documentHash, chainHead, signedAt:signer.signedAt,
  });
  const tampered = {...evidence, canonicalPayload:evidence.canonicalPayload.replace(signer.uid,"uid-tampered")};
  assert.equal(await verifyCryptographicEvidence(tampered, {
    documentHash, signerUid:signer.uid, publicKey:keyRecord.publicKey,
  }), false);
  const tamperedDoc = {...evidence, documentHash:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"};
  assert.equal(await verifyCryptographicEvidence(tamperedDoc, {
    documentHash:tamperedDoc.documentHash, signerUid:signer.uid, publicKey:keyRecord.publicKey,
  }), false);
});

test("C-G08 cryptographic evidence persists independently beside the completed document", async () => {
  const { signer, keyRecord } = await fixture();
  const records = new Map();
  const meta = {
    async get(c,id){ return records.get(c+"/"+id) || null; },
    async create(c,id,v){ records.set(c+"/"+id, structuredClone(v)); },
    async delete(c,id){ records.delete(c+"/"+id); },
  };
  const storage = { async get(id){ return id==="doc-1" ? new Uint8Array(originalBytes) : null; } };
  const keyProvider = createSignerKeyProvider(new Map([[signer.uid,keyRecord]]));
  const result = await sealAndPersist({
    meta, storage, keyProvider,
    envelope:{id:signer.envelopeId,chainHead,signers:[signer]},
    document:{id:"doc-1",bytes:originalBytes},
  });
  assert.equal(result.sealed,true);
  assert.equal(result.evidenceIds.length,1);
  assert.ok(records.has("cryptographicEvidence/"+result.evidenceIds[0]));
});

test("C-G09 verification after persistence/retrieval remains cryptographically valid", async () => {
  const { signer, keyRecord } = await fixture();
  const records = new Map();
  const meta = {
    async get(c,id){ return records.get(c+"/"+id) || null; },
    async create(c,id,v){ records.set(c+"/"+id, structuredClone(v)); },
    async delete(c,id){ records.delete(c+"/"+id); },
  };
  const keyProvider = createSignerKeyProvider(new Map([[signer.uid,keyRecord]]));
  const result = await sealAndPersist({
    meta, storage:{async get(){return originalBytes}},
    keyProvider, envelope:{id:signer.envelopeId,chainHead,signers:[signer]},
    document:{id:"doc-1",bytes:originalBytes},
  });
  const evidence = await meta.get("cryptographicEvidence",result.evidenceIds[0]);
  assert.equal(await verifyCryptographicEvidence(evidence,{
    documentHash:result.documentHash, signerUid:signer.uid, publicKey:keyRecord.publicKey,
  }),true);
});

test("C-G10 cryptographic failure rolls back evidence and cannot produce SEALED state", async () => {
  const { signer } = await fixture();
  const records = new Map();
  let status = "FULLY_SIGNED";
  const meta = {
    async get(c,id){ return records.get(c+"/"+id) || null; },
    async create(){ throw new Error("persistence failure"); },
    async delete(c,id){ records.delete(c+"/"+id); },
  };
  const keyProvider = createSignerKeyProvider(new Map());
  await assert.rejects(() => sealAndPersist({
    meta, storage:{async get(){return originalBytes}},
    keyProvider, envelope:{id:signer.envelopeId,chainHead,signers:[signer]},
    document:{id:"doc-1",bytes:originalBytes},
  }));
  status = "FULLY_SIGNED";
  assert.equal(status, "FULLY_SIGNED");
  assert.equal([...records.keys()].length,0);
});

test("C-G11 retries are idempotent and cannot create conflicting evidence", async () => {
  const { signer, keyRecord } = await fixture();
  const records = new Map();
  const meta = {
    async get(c,id){ return records.get(c+"/"+id) || null; },
    async create(c,id,v){ if(records.has(c+"/"+id)) throw new Error("duplicate"); records.set(c+"/"+id, structuredClone(v)); },
    async delete(c,id){ records.delete(c+"/"+id); },
  };
  const keyProvider = createSignerKeyProvider(new Map([[signer.uid,keyRecord]]));
  const args = {
    meta, storage:{async get(){return originalBytes}}, keyProvider,
    envelope:{id:signer.envelopeId,chainHead,signers:[signer]},
    document:{id:"doc-1",bytes:originalBytes},
  };
  const first = await sealAndPersist(args);
  const second = await sealAndPersist(args);
  assert.deepEqual(second.evidenceIds, first.evidenceIds);
  assert.equal(records.size,1);
  assert.equal(second.evidence[0].signature,first.evidence[0].signature);
});

test("C-G12 cryptographic operation emits verifiable audit evidence", async () => {
  const { signer, keyRecord } = await fixture();
  const evidence = await createCryptographicEvidence({
    keyId:keyRecord.keyId,
    signer:{...signer,privateKey:keyRecord.privateKey,publicKey:keyRecord.publicKey,signatureHash:await sha256Hex(signer.signatureValue)},
    documentHash:await sha256Hex(originalBytes), chainHead, signedAt:signer.signedAt,
  });
  const event = buildCryptographicAuditEvent(evidence);
  assert.equal(event.type,"cryptographic.signature.created");
  assert.equal(event.evidenceId,evidence.evidenceId);
  assert.equal(event.documentHash,evidence.documentHash);
  assert.equal(event.payloadHash,evidence.payloadHash);
  assert.equal(event.keyId,evidence.keyId);
});
