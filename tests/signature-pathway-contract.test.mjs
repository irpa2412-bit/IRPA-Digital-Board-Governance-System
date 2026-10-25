import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("controlled upload allocates one Firestore ID before gateway upload and writes it into Drive description", async () => {
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
  assert.match(data, /doc\(db, collectionName, String\(recordId\)\)/);
  assert.match(storage, /gatewayPost\(\"\/api\/upload-controlled-document\"/);
  const uploadRoute = worker.slice(worker.indexOf("async function uploadControlledDocument"), worker.indexOf("const categoryFile=await uploadToFolder"));
  assert.match(uploadRoute, /const documentId = cleanId\(data\.documentId \|\| ""\)/);
  assert.match(uploadRoute, /description:JSON\.stringify\(\{/);
  assert.match(uploadRoute, /documentId,\s*documentUid:documentId/);
});

test("reconcile route authorizes administrators, verifies registered file ownership, and returns a line per file", async () => {
  const worker = await read("../drive-gateway/src/index.js");
  const route = worker.slice(worker.indexOf("async function reconcileSignatureDocumentIds"), worker.indexOf("async function uploadControlledDocument"));
  assert.match(worker, /api\/signature-pathway\/reconcile/);
  assert.match(route, /adminProfiles/);
  assert.match(route, /registeredIds\.includes\(fileId\)/);
  assert.match(route, /description\.documentId/);
  assert.match(route, /method:"PATCH"/);
  assert.match(route, /results\.push\(line\)/);
  assert.match(route, /already correct/);
  assert.match(route, /status = "repaired"/);
  assert.match(route, /status = "failed"/);
});

test("signature palette exposes readable errors in an accessible visible status area", async () => {
  const platform = await read("../src/pages/SignaturePlatform.jsx");
  const storage = await read("../src/firebase/signatureStorage.js");
  assert.match(platform, /className="auth-message" role="alert" aria-live="assertive"/);
  assert.match(platform, /\{message\s*&&\s*<div className="auth-message"/);
  assert.match(platform, /setMessage/);
  assert.match(storage, /STEP controlled download failed/);
  assert.match(storage, /documentId/);
});
