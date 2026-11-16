import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const diagnostic = read("../src/firebase/signatureFirestoreDiagnostics.js");
const panel = read("../src/components/SigningDiagnostic.jsx");
const platform = read("../src/firebase/signaturePlatform.js");
const identity = read("../src/firebase/signerIdentity.js");
const register = read("../src/firebase/data.js");
const lifecycle = read("../src/pages/DocumentLifecycleModule.jsx");
const selfTest = read("../src/components/SignaturePathwaySelfTest.jsx");
const worker = read("../drive-gateway/src/index.js");

test("one shared Firestore wrapper emits only masked, non-payload diagnostic metadata", () => {
  assert.match(diagnostic, /export function runSignatureFirestore/);
  assert.match(diagnostic, /maskPath\(collectionPath\|\|targetPath\(target\)\)/);
  assert.match(diagnostic, /errorCode:safeCode\(error\)/);
  assert.doesNotMatch(diagnostic, /error\.message|error\.stack|request\.auth|Authorization|email:/);
  assert.match(panel, /Signing diagnostic/);
  assert.match(panel, /Copy Report/);
});

test("signature-flow Firestore request sites use the shared diagnostic wrapper", () => {
  assert.match(platform, /firestoreGetDoc/);
  assert.match(platform, /firestoreGetDocs/);
  assert.match(platform, /firestoreSetDoc/);
  assert.match(platform, /firestoreUpdateDoc/);
  assert.match(platform, /firestoreRunTransaction/);
  assert.match(platform, /wrapSignatureBatch/);
  assert.match(identity, /runSignatureFirestore/);
  assert.match(register, /Signer Authority Register Lookup/);
  assert.match(lifecycle, /Document Lifecycle \/ Translation Requests/);
  assert.match(selfTest, /Signature Pathway Self-Test/);
});

test("Drive health route is administrator-only, GET-only, refreshes without file mutation and returns classifications only", () => {
  const route = worker.slice(worker.indexOf("async function signatureDriveHealthRoute"), worker.indexOf("async function getDriveAccessToken"));
  assert.match(worker, /pathname === "\/api\/signature-pathway\/drive-health"/);
  assert.match(route, /request\.method !== "GET"/);
  assert.match(route, /authenticateFirebaseRequest/);
  assert.match(route, /await getDriveAccessToken\(env\)/);
  assert.match(route, /statusClass: "ok", classification: "ok"/);
  assert.match(route, /statusClass: "error", classification/);
  assert.doesNotMatch(route, /driveFetch|\.put\(|\.delete\(|accessToken|refreshToken|client_secret|error\.message|\bok:/);
  assert.match(selfTest, /\/api\/signature-pathway\/drive-health/);
});
