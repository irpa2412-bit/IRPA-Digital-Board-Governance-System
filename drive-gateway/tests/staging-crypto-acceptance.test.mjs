import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { memoryMeta, memoryStorage } from "../src/adapters.mjs";
import {
  cryptoKeySecretName,
  createCloudflareSignerKeyProvider,
  importPublicKeyJwk,
  verifyCryptographicEvidence,
} from "../src/cryptographicGate.mjs";
import { finalizeEnvelope, verifyChain } from "../src/signing.mjs";
import { sha256Hex } from "../src/util.mjs";

async function makeStagingSecret(signerUid) {
  const pair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", pair.privateKey));
  const publicKeyJwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  const binary = String.fromCharCode(...pkcs8);
  const secret = JSON.stringify({
    version: 1,
    keyId: "IRPA-STAGING-CRYPTO-001",
    privateKeyPkcs8: Buffer.from(binary, "binary").toString("base64"),
    publicKeyJwk: {
      kty: publicKeyJwk.kty,
      crv: publicKeyJwk.crv,
      x: publicKeyJwk.x,
      y: publicKeyJwk.y,
      ext: true,
    },
  });
  const secretName = await cryptoKeySecretName(signerUid);
  return { env: { [secretName]: secret }, secretName };
}

async function fixture() {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("IRPA staging cryptographic acceptance transaction", { x: 50, y: 700 });
  const bytes = await pdf.save();
  const originalHash = await sha256Hex(bytes);
  const meta = memoryMeta();
  const storage = memoryStorage();
  await storage.put({
    path: "staging-test.pdf",
    bytes,
    contentType: "application/pdf",
    metadata: { documentId: "DOC-STAGING-CRYPTO-001" },
  });
  const original = [...storage.objs.entries()][0];
  await meta.create("documents", "DOC-STAGING-CRYPTO-001", {
    id: "DOC-STAGING-CRYPTO-001",
    hash: originalHash,
    primaryStorageId: original[0],
    title: "Staging Cryptographic Acceptance",
    fileName: "staging-crypto.pdf",
    classification: "Restricted",
    status: "Stored",
    ownerUid: "owner-staging-001",
  });

  const signerUid = "uid-staging-crypto-001";
  const envelope = {
    id: "ENV-STAGING-CRYPTO-001",
    documentId: "DOC-STAGING-CRYPTO-001",
    documentHash: originalHash,
    title: "Staging Cryptographic Acceptance",
    fileName: "staging-crypto.pdf",
    classification: "Restricted",
    createdBy: "owner-staging-001",
    status: "Completing",
    signers: [{
      id: "S1",
      uid: signerUid,
      email: "staging-signer@example.org",
      name: "Staging Signer",
      order: 1,
      status: "Signed",
      signedAt: "2026-10-07T19:30:00.000Z",
      signatureType: "typed",
      signatureValue: "Staging Acceptance Signature",
    }],
    archiveTargets: ["legal-contracts"],
    events: [{
      type: "envelope.created",
      at: "2026-10-07T19:00:00.000Z",
      prevHash: "GENESIS",
      hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }],
    completion: null,
  };
  await meta.create("envelopes", envelope.id, envelope);
  const stagingSecret = await makeStagingSecret(signerUid);
  return { meta, storage, envelope, stagingSecret };
}

test("C-G13 staging custody resolves the signer key through the Cloudflare-style environment binding", async () => {
  const f = await fixture();
  const provider = createCloudflareSignerKeyProvider(f.stagingSecret.env);
  const record = await provider.getSignerKey(f.envelope.signers[0].uid);

  assert.equal(record.keyId, "IRPA-STAGING-CRYPTO-001");
  assert.equal(record.privateKey.extractable, false);
  assert.deepEqual(record.privateKey.usages, ["sign"]);
  assert.equal(record.publicKey.extractable, true);
  assert.deepEqual(record.publicKey.usages, ["verify"]);
});

test("C-G14 through C-G20 staging transaction persists and independently verifies cryptographic evidence", async () => {
  const f = await fixture();
  const provider = createCloudflareSignerKeyProvider(f.stagingSecret.env);

  const result = await finalizeEnvelope({
    meta: f.meta,
    storage: f.storage,
    now: () => new Date("2026-10-07T20:00:00.000Z"),
    config: { ttlDays: 14 },
    crypto: { keyProvider: provider },
  }, f.envelope.id);

  assert.equal(result.completed, true);

  const state = await f.meta.get("envelopes", f.envelope.id);
  assert.equal(state.status, "Completed");
  assert.equal(state.completion.cryptographicEvidenceIds.length, 1);

  const evidenceId = state.completion.cryptographicEvidenceIds[0];
  const evidence = await f.meta.get("cryptographicEvidence", evidenceId);
  const finalBytes = await f.storage.get(state.completion.primaryStorageId);

  assert.ok(evidence);
  assert.equal(evidence.status, "SEALED");
  assert.equal(evidence.signerUid, f.envelope.signers[0].uid);
  assert.equal(evidence.keyId, "IRPA-STAGING-CRYPTO-001");
  assert.equal(evidence.documentHash, state.completion.finalHash);
  assert.equal(await sha256Hex(finalBytes), state.completion.finalHash);
  assert.equal(await sha256Hex(evidence.canonicalPayload), evidence.payloadHash);
  assert.equal("privateKey" in evidence, false);
  assert.equal("privateKeyPkcs8" in evidence, false);

  const publicKey = await importPublicKeyJwk(evidence.publicKeyJwk);
  assert.equal(await verifyCryptographicEvidence(evidence, {
    documentHash: state.completion.finalHash,
    signerUid: f.envelope.signers[0].uid,
    publicKey,
  }), true);

  const cryptoEvent = state.events.find(e => e.type === "cryptographic.signature.created");
  assert.ok(cryptoEvent);
  assert.equal(cryptoEvent.evidenceId, evidenceId);
  assert.equal(cryptoEvent.documentHash, state.completion.finalHash);
  assert.equal(await verifyChain(state.events), true);

  const tamperedBytes = new Uint8Array(finalBytes);
  tamperedBytes[tamperedBytes.length - 1] ^= 1;
  assert.notEqual(await sha256Hex(tamperedBytes), evidence.documentHash);
  assert.equal(await verifyCryptographicEvidence(evidence, {
    documentHash: await sha256Hex(tamperedBytes),
    signerUid: f.envelope.signers[0].uid,
    publicKey,
  }), false);

  const persistedAgain = await f.meta.get("cryptographicEvidence", evidenceId);
  assert.deepEqual(persistedAgain, evidence);
});

test("C-G19 staging transaction rejects tampered persisted cryptographic payload", async () => {
  const f = await fixture();
  const provider = createCloudflareSignerKeyProvider(f.stagingSecret.env);

  await finalizeEnvelope({
    meta: f.meta,
    storage: f.storage,
    now: () => new Date("2026-10-07T20:00:00.000Z"),
    config: { ttlDays: 14 },
    crypto: { keyProvider: provider },
  }, f.envelope.id);

  const state = await f.meta.get("envelopes", f.envelope.id);
  const evidence = await f.meta.get("cryptographicEvidence", state.completion.cryptographicEvidenceIds[0]);
  const publicKey = await importPublicKeyJwk(evidence.publicKeyJwk);
  const tampered = { ...evidence, canonicalPayload: evidence.canonicalPayload.replace(f.envelope.signers[0].uid, "uid-tampered") };

  assert.equal(await verifyCryptographicEvidence(tampered, {
    documentHash: evidence.documentHash,
    signerUid: evidence.signerUid,
    publicKey,
  }), false);
});
