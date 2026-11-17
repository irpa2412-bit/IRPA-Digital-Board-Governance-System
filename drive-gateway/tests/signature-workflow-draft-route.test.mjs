import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync("src/index.js", "utf8");
const client = fs.readFileSync("../src/firebase/signaturePlatform.js", "utf8");
const storage = fs.readFileSync("../src/firebase/signatureStorage.js", "utf8");
const selfTest = fs.readFileSync("../src/components/SignaturePathwaySelfTest.jsx", "utf8");
const batch = fs.readFileSync("../src/utils/controlledDocumentDiagnosticBatch.mjs", "utf8");
const rules = fs.readFileSync("../firestore.rules", "utf8");

test("signature draft save is routed through the authenticated Worker", () => {
  assert.match(worker, /pathname === "\/api\/signature-workflow\/draft"/);
  assert.match(worker, /authenticateFirebaseRequest\(request, env\)/);
  assert.match(worker, /getFirestoreAdminAccessToken\(env\)/);
  assert.match(worker, /activeAdmin.*activeMember/s);
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

test("Worker reconciliation is single-document, read-only, and does not repair documents", () => {
  assert.match(worker, /Exactly one controlled document must be checked per Worker request/);
  assert.match(worker, /diagnoseControlledDocument/);
  assert.match(worker, /This diagnostic endpoint is read-only/);
  assert.match(worker, /writesPerformed:false,driveMutationsPerformed:false/);
  assert.match(selfTest, /reconcileSignatureDocumentIds\(oneDocument, options\)/);
  assert.match(batch, /requestDocument\(\[item\], \{ dryRun: true, autoDiscover: false \}\)/);
  assert.doesNotMatch(selfTest, /wiAfPSIxHLTd6MdeM04q/);
  assert.doesNotMatch(selfTest, /autoDiscover: true/);
  assert.match(selfTest, /Copy report/);
  assert.match(selfTest, /Classification:/);
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

test("signature owner activation, append-only audit, signer mirror and signed-document list are Gateway-only",()=>{
  assert.ok(worker.includes('pathname === "/api/signature-workflow/activate"'));
  assert.ok(worker.includes('pathname === "/api/signature-workflow/audit"'));
  assert.ok(worker.includes('pathname === "/api/signature-workflow/mirror"'));
  assert.ok(worker.includes('pathname === "/api/signature-workflow/signed-documents"'));
  assert.match(worker,/Only the original document owner may activate this signing workflow/);
  assert.match(worker,/currentDocument:\{exists:false\}/);
  assert.match(worker,/cryptographicEvidenceStatus:row.cryptographicEvidenceStatus/);
  assert.match(worker,/signerArchiveUrl:row.signerArchiveUrl/);
  assert.doesNotMatch(worker,/documents:\s*rows\.filter/);
  assert.match(client,/\/api\/signature-workflow\/activate/);
  assert.match(client,/\/api\/signature-workflow\/audit/);
  assert.match(client,/\/api\/signature-workflow\/mirror/);
  assert.match(client,/\/api\/signature-workflow\/signed-documents/);
  assert.match(storage,/\/api\/sign\/submit/);
  assert.doesNotMatch(client,/await updateDoc\(doc\(db,ENVELOPE_COLLECTION/);
});
