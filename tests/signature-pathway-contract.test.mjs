import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("controlled upload allocates one Firestore ID before gateway upload and persists that ID", async () => {
  const [upload, storage, worker, data] = await Promise.all([
    read("../src/components/ControlledDocumentUpload.jsx"),
    read("../src/firebase/signatureStorage.js"),
    read("../drive-gateway/src/index.js"),
    read("../src/firebase/data.js")
  ]);
  const allocate = upload.indexOf("const documentUid = doc(collection(db, COLLECTIONS.documents)).id;");
  const routedUpload = upload.indexOf("uploadControlledDocumentRouted({", allocate);
  assert.ok(allocate >= 0 && routedUpload > allocate, "Firestore ID must be allocated before gateway upload");
  assert.match(upload.slice(routedUpload, routedUpload + 500), /documentId:\s*documentUid/);
  assert.match(upload, /createRecord\(COLLECTIONS\.documents, pendingDocument\.documentPayload, pendingDocument\.documentId\)/);
  assert.match(data, /recordId\s*=\s*null/);
  assert.match(data, /doc\(db, collectionName, recordId\)/);
  assert.match(storage, /gatewayPost\("\/api\/upload-controlled-document"/);
  assert.match(worker, /api\/upload-controlled-document/);
  assert.match(worker, /description/);
  assert.match(worker, /documentId/);
});

test("reconcile endpoint is administrator-authorized, validates document/file pairing, and returns per-file results", async () => {
  const worker = await read("../drive-gateway/src/index.js");
  assert.match(worker, /api\/signature-pathway\/reconcile/);
  assert.match(worker, /adminProfiles/);
  assert.match(worker, /description/);
  assert.match(worker, /documentId/);
  assert.match(worker, /alreadyCorrect/);
  assert.match(worker, /failed/);
});

test("signature palette exposes readable errors in the visible status area", async () => {
  const platform = await read("../src/pages/SignaturePlatform.jsx");
  const storage = await read("../src/firebase/signatureStorage.js");
  assert.match(platform, /className="auth-message"/);
  assert.match(platform, /className="auth-message" role="alert" aria-live="assertive"/);
  assert.match(platform, /\{message\s*&&\s*<div className="auth-message"/);
  assert.match(platform, /setMessage/);
  assert.match(storage, /STEP controlled download failed/);
  assert.match(storage, /documentId/);
});
