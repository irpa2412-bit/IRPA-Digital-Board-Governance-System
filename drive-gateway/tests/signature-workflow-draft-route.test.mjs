import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync("drive-gateway/src/index.js", "utf8");
const client = fs.readFileSync("src/firebase/signaturePlatform.js", "utf8");
const selfTest = fs.readFileSync("src/components/SignaturePathwaySelfTest.jsx", "utf8");
const rules = fs.readFileSync("firestore.rules", "utf8");

test("signature draft save is routed through the authenticated Worker", () => {
  assert.match(worker, /pathname === "\/api\/signature-workflow\/draft"/);
  assert.match(worker, /authenticateFirebaseRequest\(request, env\)/);
  assert.match(worker, /getFirestoreAdminAccessToken\(env\)/);
  assert.match(worker, /activeAdmin.*activeStatus\(member\).*activeStatus\(employee\)/s);
  assert.match(worker, /signatureEnvelopes\//);
  assert.match(worker, /signatureEvents\//);
  assert.match(worker, /documents\//);
  assert.match(worker, /documents:commit/);
  const start = client.indexOf("export async function saveSignatureWorkflowDraft(");
  const end = client.indexOf("\nexport async function finalizeSignatureWorkflowDraft", start);
  const fn = client.slice(start, end);
  assert.match(fn, /\/api\/signature-workflow\/draft/);
  assert.doesNotMatch(fn, /setDoc\(doc\(db,ENVELOPE_COLLECTION/);
  assert.doesNotMatch(fn, /updateDoc\(doc\(db,"documents"/);
  assert.doesNotMatch(fn, /recordEnvelopeEvent\(id,"Owner Section Saved"/);
});

test("Worker reconciliation reports the previous Drive ID and verifies the repaired value", () => {
  assert.match(worker, /previousDescriptionDocumentId/);
  assert.match(worker, /Drive description verification failed after repair/);
  assert.match(selfTest, /wiAfPSIxHLTd6MdeM04q/);
  assert.match(selfTest, /1iGhrGLVTlBtxiwtVlVzPi7rXK3PzdcJ-/);
  assert.match(selfTest, /previousDescriptionDocumentId/);
});

test("new controlled uploads verify the exact canonical document ID in Drive metadata", () => {
  assert.match(worker, /Controlled upload failed metadata verification/);
  assert.match(worker, /storedDescription\.documentId/);
  assert.match(worker, /documentUid:documentId/);
});

test("existing Firestore rules are unchanged and their actual-data gate remains explicit", () => {
  assert.match(rules, /match \/signatureEnvelopes\/\{id\}.*actualCreateAllowed\(\)/);
  assert.match(rules, /function actualCreateAllowed\(\)\{return actualDataAccessOpen\(\)\|\|trialDataRecord\(request\.resource\.data\);\}/);
});
