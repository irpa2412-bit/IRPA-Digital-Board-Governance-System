import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { memoryMeta, memoryStorage } from "../src/adapters.mjs";
import { finalizeEnvelope } from "../src/signing.mjs";
import { generateSignerKeyPair, importPublicKeyJwk, verifyCryptographicEvidence, createSignerKeyProvider } from "../src/cryptographicGate.mjs";
import { sha256Hex } from "../src/util.mjs";

async function fixture() {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Production cryptographic integration fixture", { x: 50, y: 700 });
  const bytes = await pdf.save();
  const meta = memoryMeta();
  const storage = memoryStorage();
  const originalHash = await sha256Hex(bytes);
  await storage.put({ path:"original.pdf", bytes, contentType:"application/pdf", metadata:{documentId:"DOC-CI-001"} });
  const original = [...storage.objs.entries()][0];
  await meta.create("documents","DOC-CI-001",{
    id:"DOC-CI-001",
    hash:originalHash,
    primaryStorageId:original[0],
    title:"Production Crypto Integration",
    fileName:"production-crypto.pdf",
    classification:"Restricted",
    status:"Stored",
    ownerUid:"owner-001",
  });
  const keyPair = await generateSignerKeyPair();
  const signer = {
    id:"S1",
    uid:"uid-production-001",
    email:"signer@example.org",
    name:"Production Signer",
    order:1,
    status:"Signed",
    signedAt:"2026-10-07T18:30:00.000Z",
    signatureType:"typed",
    signatureValue:"Production Integration Signature",
  };
  const envelope = {
    id:"ENV-CI-001",
    dataEnvironment:"ACTUAL",
    documentId:"DOC-CI-001",
    documentHash:originalHash,
    title:"Production Crypto Integration",
    fileName:"production-crypto.pdf",
    classification:"Restricted",
    createdBy:"owner-001",
    status:"Completing",
    signers:[signer],
    archiveTargets:["legal-contracts"],
    events:[{type:"envelope.created",at:"2026-10-07T18:00:00.000Z",prevHash:"GENESIS",hash:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}],
    completion:null,
  };
  await meta.create("envelopes",envelope.id,envelope);
  return {meta,storage,keyPair,envelope};
}

test("C-I01 production finalize seals the exact final PDF before Completed", async () => {
  const f = await fixture();
  const keyProvider = createSignerKeyProvider(new Map([[f.envelope.signers[0].uid,{keyId:"IRPA-KEY-PROD-001",...f.keyPair}]]));
  const result = await finalizeEnvelope({...{meta:f.meta,storage:f.storage,env:{DRIVE_MOCK:"false",IRPA_ENVIRONMENT:"production"},now:()=>new Date("2026-10-07T19:00:00.000Z"),config:{ttlDays:14}},crypto:{keyProvider}},f.envelope.id);
  assert.equal(result.completed,true);
  const state = await f.meta.get("envelopes",f.envelope.id);
  assert.equal(state.status,"Completed");
  assert.equal(state.completion.cryptographicEvidenceIds.length,1);
  const evidence = await f.meta.get("cryptographicEvidence",state.completion.cryptographicEvidenceIds[0]);
  const finalBytes = await f.storage.get(state.completion.primaryStorageId);
  assert.equal(await sha256Hex(finalBytes),state.completion.finalHash);
  assert.equal(evidence.documentHash,state.completion.finalHash);
  const publicKey = await importPublicKeyJwk(evidence.publicKeyJwk);
  assert.equal(await verifyCryptographicEvidence(evidence,{
    documentHash:state.completion.finalHash,
    signerUid:f.envelope.signers[0].uid,
    publicKey,
  }),true);
});

test("C-I02 production finalize fails closed when signer key custody is unavailable", async () => {
  const f = await fixture();
  const before = f.storage.objs.size;
  const result = await finalizeEnvelope({
    meta:f.meta,
    storage:f.storage,
    env:{DRIVE_MOCK:"false",IRPA_ENVIRONMENT:"production"},
    now:()=>new Date("2026-10-07T19:00:00.000Z"),
    config:{ttlDays:14},
    crypto:{keyProvider:createSignerKeyProvider(new Map())},
  },f.envelope.id);
  assert.equal(result.ok,false);assert.equal(result.completed,false);assert.equal(result.error,"COMPLETION_FAILED");assert.equal(result.failure.code,"COMPLETION_FAILED");assert.equal(result.failure.stage,"SEAL_CRYPTOGRAPHIC_EVIDENCE");assert.equal(result.failure.retryable,true);
  const state = await f.meta.get("envelopes",f.envelope.id);
  assert.equal(state.status,"CompletionFailed");
  assert.ok(state.completion?.archivePending?.storageId);
  assert.equal(state.completion.archivePending.environment,"ACTUAL");
  assert.equal(f.storage.objs.size,before+1);
  assert.equal((await f.meta.list("cryptographicEvidence")).length,0);
});


test("C-I03 production completion fails closed when the cryptographic key provider is absent", async () => {
  const f = await fixture();
  const before = f.storage.objs.size;
  const result = await finalizeEnvelope({
    meta:f.meta,
    storage:f.storage,
    env:{DRIVE_MOCK:"false",IRPA_ENVIRONMENT:"production"},
    now:()=>new Date("2026-10-07T19:00:00.000Z"),
    config:{ttlDays:14}
  },f.envelope.id);
  assert.equal(result.ok,false);assert.equal(result.completed,false);assert.equal(result.error,"COMPLETION_FAILED");assert.equal(result.failure.code,"COMPLETION_FAILED");assert.equal(result.failure.stage,"SEAL_CRYPTOGRAPHIC_EVIDENCE");assert.equal(result.failure.retryable,true);
  const state=await f.meta.get("envelopes",f.envelope.id);
  assert.equal(state.status,"CompletionFailed");
  assert.ok(state.completion?.archivePending?.storageId);
  assert.equal(state.completion.archivePending.environment,"ACTUAL");
  assert.equal(f.storage.objs.size,before+1);
  assert.equal((await f.meta.list("cryptographicEvidence")).length,0);
});


test("C-I04 post-completion distribution/reporting failures never roll back Completed", async () => {
  const f = await fixture();
  const originalGet = f.meta.get.bind(f.meta);
  f.meta.get = async (collection, id) => {
    if (collection === "envelopes") {
      const current = await originalGet(collection, id);
      if (current?.status === "Completed") throw new Error("mock post-completion envelope read failure");
      return current;
    }
    return originalGet(collection, id);
  };
  const keyProvider = createSignerKeyProvider(new Map([[f.envelope.signers[0].uid,{keyId:"IRPA-KEY-PROD-001",...f.keyPair}]]));
  const result = await finalizeEnvelope({
    meta:f.meta,
    storage:f.storage,
    env:{DRIVE_MOCK:"false",IRPA_ENVIRONMENT:"production"},
    now:()=>new Date("2026-10-07T19:00:00.000Z"),
    config:{ttlDays:14},
    crypto:{keyProvider},
    logger:{error(){}},
  },f.envelope.id);
  assert.equal(result.ok,true);
  assert.equal(result.completed,true);
  assert.equal(result.status,"Completed");
  assert.equal(result.distributionRecoveryRequired,true);
  const state = await originalGet("envelopes",f.envelope.id);
  assert.equal(state.status,"Completed");
  assert.ok(state.completion.primaryStorageId);
  assert.equal(await f.storage.get(state.completion.primaryStorageId) instanceof Uint8Array,true);
  assert.equal(state.completion.finalHash,result.completion.finalHash);
});


test("C-I05 already-completed envelope stays Completed when delivery reconciliation reads fail", async () => {
  const f = await fixture();
  const keyProvider = createSignerKeyProvider(new Map([[f.envelope.signers[0].uid,{keyId:"IRPA-KEY-PROD-001",...f.keyPair}]]));
  const ctx = {
    meta:f.meta,
    storage:f.storage,
    env:{DRIVE_MOCK:"false",IRPA_ENVIRONMENT:"production"},
    now:()=>new Date("2026-10-07T19:00:00.000Z"),
    config:{ttlDays:14},
    crypto:{keyProvider},
    logger:{error(){}},
  };
  const first = await finalizeEnvelope(ctx,f.envelope.id);
  assert.equal(first.completed,true);
  const originalGet = f.meta.get.bind(f.meta);
  let allowInitialEnvelopeRead = true;
  f.meta.get = async (collection,id) => {
    if (collection === "envelopes") {
      const current = await originalGet(collection,id);
      if (current?.status === "Completed" && allowInitialEnvelopeRead) {
        allowInitialEnvelopeRead = false;
        return current;
      }
      if (current?.status === "Completed") throw new Error("mock completed reconciliation read failure");
      return current;
    }
    return originalGet(collection,id);
  };
  const retried = await finalizeEnvelope(ctx,f.envelope.id);
  assert.equal(retried.ok,true);
  assert.equal(retried.completed,true);
  assert.equal(retried.status,"Completed");
  assert.equal(retried.distributionRecoveryRequired,true);
  const state = await originalGet("envelopes",f.envelope.id);
  assert.equal(state.status,"Completed");
  assert.equal(state.completion.finalHash,first.completion.finalHash);
});
