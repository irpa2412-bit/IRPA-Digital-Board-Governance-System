import test from "node:test";
import assert from "node:assert/strict";
import { persistCompletedSignatureEnvelope } from "../src/signatureMirror.mjs";

test("completed gateway signing updates portal envelope, appends trail event, and exposes lifecycle-compatible fields", async () => {
  const docs = new Map([["signatureEnvelopes/IRPA-ENV-2026-12345678", {
    documentId: "DOC-42", gatewayEnvelopeId: "ENV-abc", participantUids: ["officer-1"], status: "In Progress"
  }], ["documents/DOC-42", { status: "PENDING_SIGNATURE" }]]);
  const writes = [];
  const getDocument = async path => docs.get(path) || null;
  const updateDocument = async (path, fields) => {
    writes.push({path, fields});
    docs.set(path, {...(docs.get(path) || {}), ...fields});
  };
  await persistCompletedSignatureEnvelope({
    envelope: {
      id: "ENV-abc", externalReference: "IRPA-ENV-2026-12345678", documentId: "DOC-42",
      signers: [{uid:"officer-1",name:"Authorization Officer",email:"officer@example.org",status:"Signed",signedAt:"2026-10-24T05:00:00.000Z"}]
    },
    completion: {primaryStorageId:"drive-file-7",finalHash:"a".repeat(64),completedAt:"2026-10-24T05:00:00.000Z"},
    getDocument, updateDocument, now: () => "2026-10-24T05:00:01.000Z"
  });
  const envelope = docs.get("signatureEnvelopes/IRPA-ENV-2026-12345678");
  assert.equal(envelope.status, "Completed");
  assert.equal(envelope.documentId, "DOC-42");
  assert.equal(envelope.lastSignedByUid, "officer-1");
  assert.equal(envelope.signedDocumentUrl, "https://drive.google.com/file/d/drive-file-7/view");
  assert.equal(envelope.signedPdfReference, "drive-file-7");
  assert.equal(envelope.signers[0].status, "Signed");
  const signerEvent = writes.find(write => write.path === "signatureEvents/gateway-signed-IRPA-ENV-2026-12345678-officer-1");
  assert.ok(signerEvent, "a per-signer signature event must be written");
  assert.equal(signerEvent.fields.envelopeId, "IRPA-ENV-2026-12345678");
  assert.equal(signerEvent.fields.event, "Gateway Signer Signed");
  assert.equal(signerEvent.fields.actorUid, "officer-1");
  assert.equal(signerEvent.fields.signedAt, "2026-10-24T05:00:00.000Z");
  const completionEvent = writes.find(write => write.path === "signatureEvents/gateway-completed-IRPA-ENV-2026-12345678");
  assert.ok(completionEvent, "a completion event must be written");
  assert.equal(completionEvent.fields.envelopeId, "IRPA-ENV-2026-12345678");
  assert.equal(completionEvent.fields.event, "Gateway Signing Completed");
  assert.equal(completionEvent.fields.details.status, "Completed");
  assert.equal(completionEvent.fields.details.signedDocumentUrl, envelope.signedDocumentUrl);
  // documentLifecycle's signature-complete handler accepts only Completed and a URL it can resolve to a Drive file ID.
  assert.equal(envelope.status, "Completed");
  assert.equal(envelope.signedDocumentUrl.match(/\/file\/d\/([^/]+)\/view/)?.[1], "drive-file-7");
  docs.set("documents/DOC-42", {...docs.get("documents/DOC-42"), status:"SIGNED", signatureStatus:"COMPLETED", signatureEnvelopeId:"IRPA-ENV-2026-12345678", signedByUid:envelope.lastSignedByUid, signedDocumentUrl:envelope.signedDocumentUrl});
  assert.equal(docs.get("documents/DOC-42").status, "SIGNED");
});


test("per-signer and completion audit events use stable IDs and are idempotent", async () => {
  const envelopeId = "IRPA-ENV-IDEMPOTENT";
  const docs = new Map([[ "signatureEnvelopes/" + envelopeId, { documentId: "DOC-99", status: "In Progress" } ]]);
  const writes = [];
  const getDocument = async path => docs.get(path) || null;
  const updateDocument = async (path, fields) => {
    writes.push({path, fields});
    docs.set(path, {...(docs.get(path) || {}), ...fields});
  };
  const input = {
    envelope: {
      id: "ENV-99", externalReference: envelopeId, documentId: "DOC-99",
      signers: [
        {uid:"officer-1",name:"Officer One",email:"one@example.org",status:"Signed",signedAt:"2026-10-24T05:00:00.000Z"},
        {uid:"officer-2",name:"Officer Two",email:"two@example.org",status:"Signed",signedAt:"2026-10-24T05:01:00.000Z"}
      ]
    },
    completion: {primaryStorageId:"drive-file-99",finalHash:"c".repeat(64),completedAt:"2026-10-24T05:02:00.000Z"},
    getDocument, updateDocument, now: () => "2026-10-24T05:03:00.000Z"
  };
  await persistCompletedSignatureEnvelope(input);
  const eventWritesAfterFirstCall = writes.filter(write => write.path.startsWith("signatureEvents/"));
  assert.deepEqual(eventWritesAfterFirstCall.map(write => write.path).sort(), [
    "signatureEvents/gateway-completed-" + envelopeId,
    "signatureEvents/gateway-signed-" + envelopeId + "-officer-1",
    "signatureEvents/gateway-signed-" + envelopeId + "-officer-2"
  ].sort());
  assert.equal(eventWritesAfterFirstCall.find(write => write.path.endsWith("-officer-2")).fields.signedAt, "2026-10-24T05:01:00.000Z");
  await persistCompletedSignatureEnvelope(input);
  assert.equal(writes.filter(write => write.path.startsWith("signatureEvents/")).length, 3, "repeating mirror persistence must not duplicate audit-event writes");
});

test("missing portal envelope rejects mirror write so caller can log it", async () => {
  await assert.rejects(persistCompletedSignatureEnvelope({
    envelope: {externalReference:"IRPA-ENV-MISSING", signers:[]},
    completion: {primaryStorageId:"drive-file-7",completedAt:"2026-10-24T05:00:00.000Z"},
    getDocument: async () => null,
    updateDocument: async () => assert.fail("must not write when portal envelope is absent")
  }), /portal signature envelope was not found/);
});


test("mirror fails once, records Pending, then resync succeeds", async () => {
  const gateway={id:"ENV-resync",externalReference:"IRPA-ENV-resync",status:"Completed",mirrorAttempts:0,completion:{primaryStorageId:"drive-file-8",finalHash:"b".repeat(64),completedAt:"2026-10-24T05:00:00.000Z"},signers:[{uid:"officer-1",status:"Signed"}],events:[],_v:1};
  const stored=new Map([["envelopes/ENV-resync",gateway]]);let failures=1;let portalStatus="In Progress";
  const ctx={meta:{get:async(c,id)=>stored.get(c+"/"+id)||null,update:async(c,id,p)=>stored.set(c+"/"+id,{...stored.get(c+"/"+id),...p,_v:(stored.get(c+"/"+id)._v||0)+1})},persistCompletedSignatureEnvelope:async()=>{if(failures-->0)throw new Error("temporary Firestore failure");portalStatus="Completed"},now:()=>new Date("2026-10-24T05:00:01.000Z"),logger:{error(){}}};
  const {persistMirrorWithStatus,resyncMirror}=await import("../src/signing.mjs");
  await persistMirrorWithStatus(ctx,gateway,gateway.completion);
  assert.equal(stored.get("envelopes/ENV-resync").mirrorStatus,"Pending");
  assert.equal(stored.get("envelopes/ENV-resync").mirrorError,"temporary Firestore failure");
  assert.equal(stored.get("envelopes/ENV-resync").mirrorAttempts,1);
  const result=await resyncMirror(ctx,{uid:"owner-1",isAdmin:true},gateway.id);
  assert.equal(result.mirrorStatus,"Completed");assert.equal(portalStatus,"Completed");assert.equal(result.mirrorAttempts,2);
});
