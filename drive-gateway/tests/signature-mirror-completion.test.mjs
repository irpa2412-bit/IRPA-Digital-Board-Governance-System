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
  const eventWrite = writes.find(write => write.path.startsWith("signatureEvents/"));
  assert.ok(eventWrite, "a signatureEvents document must be written");
  assert.equal(eventWrite.fields.envelopeId, "IRPA-ENV-2026-12345678");
  assert.equal(eventWrite.fields.event, "Gateway Signing Completed");
  assert.equal(eventWrite.fields.details.status, "Completed");
  assert.equal(eventWrite.fields.details.signedDocumentUrl, envelope.signedDocumentUrl);
  // documentLifecycle's signature-complete handler accepts only Completed and a URL it can resolve to a Drive file ID.
  assert.equal(envelope.status, "Completed");
  assert.equal(envelope.signedDocumentUrl.match(/\/file\/d\/([^/]+)\/view/)?.[1], "drive-file-7");
  docs.set("documents/DOC-42", {...docs.get("documents/DOC-42"), status:"SIGNED", signatureStatus:"COMPLETED", signatureEnvelopeId:"IRPA-ENV-2026-12345678", signedByUid:envelope.lastSignedByUid, signedDocumentUrl:envelope.signedDocumentUrl});
  assert.equal(docs.get("documents/DOC-42").status, "SIGNED");
});

test("missing portal envelope rejects mirror write so caller can log it", async () => {
  await assert.rejects(persistCompletedSignatureEnvelope({
    envelope: {externalReference:"IRPA-ENV-MISSING", signers:[]},
    completion: {primaryStorageId:"drive-file-7",completedAt:"2026-10-24T05:00:00.000Z"},
    getDocument: async () => null,
    updateDocument: async () => assert.fail("must not write when portal envelope is absent")
  }), /portal signature envelope was not found/);
});
