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
  const result = await finalizeEnvelope({...{meta:f.meta,storage:f.storage,now:()=>new Date("2026-10-07T19:00:00.000Z"),config:{ttlDays:14}},crypto:{keyProvider}},f.envelope.id);
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
    now:()=>new Date("2026-10-07T19:00:00.000Z"),
    config:{ttlDays:14},
    crypto:{keyProvider:createSignerKeyProvider(new Map())},
  },f.envelope.id);
  assert.deepEqual(result,{ok:false,completed:false,error:"COMPLETION_FAILED"});
  const state = await f.meta.get("envelopes",f.envelope.id);
  assert.equal(state.status,"CompletionFailed");
  assert.equal(state.completion,null);
  assert.equal(f.storage.objs.size,before);
  assert.equal((await f.meta.list("cryptographicEvidence")).length,0);
});
