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
  assert.match(upload, /pendingDocument\.documentId/);
  assert.match(data, /createRecord\(collectionName,data,recordId=null\)/);
  assert.match(data, /recordId\?doc\(db,collectionName,String\(recordId\)\):null/);
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
  assert.match(storage, /STEP gateway controlled download failed/);
  assert.match(storage, /documentId/);
});


test("actual-data gate Worker route enforces admin role, exact attestation, writes same setting fields, and audits", async () => {
  const worker = await read("../drive-gateway/src/index.js");
  const client = await read("../src/firebase/systemControl.js");
  const route = worker.slice(worker.indexOf("async function actualDataAccessRoute"), worker.indexOf("async function reconcileSignatureDocumentIds"));
  assert.match(worker, /\/api\/system\/actual-data-access/);
  assert.match(client, /\/api\/system\/actual-data-access/);
  assert.match(route, /authenticateFirebaseRequest\(request, env\)/);
  assert.match(route, /adminProfiles\//);
  assert.match(route, /profile\?\.fields\?\.active\?\.booleanValue === true/);
  assert.match(worker, /actualDataAccessPolicy\.mjs/);
  assert.match(route, /evaluateActualDataAccessPolicy/);
  assert.match(route, /status:\{stringValue:enabled\?'OPEN':'CLOSED'\}/);
  assert.match(route, /finalTestsAttested:\{booleanValue:enabled\}/);
  assert.match(route, /ACTUAL_DATA_ACCESS_OPENED/);
  assert.match(route, /Commit actual-data setting and audit atomically/);
  assert.match(route, /step\+' failed: '/);
});

test("actual-data gate rejects non-administrators and wrong attestation before changing the setting", async () => {
  const worker = await read("../drive-gateway/src/index.js");
  const route = worker.slice(worker.indexOf("async function actualDataAccessRoute"), worker.indexOf("async function reconcileSignatureDocumentIds"));
  const authorization = route.indexOf("if (!adminAllowed)");
  const policy = route.indexOf("evaluateActualDataAccessPolicy");
  const write = route.indexOf("step = 'Commit actual-data setting and audit atomically'");
  assert.ok(authorization >= 0 && policy > authorization && write > policy);
  assert.match(route, /},403,corsHeaders\(request\)/);
  assert.match(route, /policy\.status/);
});

test("actual-data gate policy allows an administrator with the exact attestation", async () => {
  const { evaluateActualDataAccessPolicy, ACTUAL_DATA_ATTESTATION } = await import("../drive-gateway/src/actualDataAccessPolicy.mjs");
  assert.deepEqual(evaluateActualDataAccessPolicy({adminAllowed:true,enabled:true,confirmation:ACTUAL_DATA_ATTESTATION}), {allowed:true,status:200,enabled:true,finalTestsAttested:true});
});

test("actual-data gate policy refuses a non-administrator", async () => {
  const { evaluateActualDataAccessPolicy, ACTUAL_DATA_ATTESTATION } = await import("../drive-gateway/src/actualDataAccessPolicy.mjs");
  const result = evaluateActualDataAccessPolicy({adminAllowed:false,enabled:true,confirmation:ACTUAL_DATA_ATTESTATION});
  assert.equal(result.allowed,false);
  assert.equal(result.status,403);
});

test("actual-data gate policy refuses a wrong attestation", async () => {
  const { evaluateActualDataAccessPolicy } = await import("../drive-gateway/src/actualDataAccessPolicy.mjs");
  const result = evaluateActualDataAccessPolicy({adminAllowed:true,enabled:true,confirmation:"I CONFIRM"});
  assert.equal(result.allowed,false);
  assert.equal(result.status,412);
});


test("registered identity reconciliation allows an authenticated active administrator", async () => {
  const { authorizeIdentityReconciliation } = await import("../drive-gateway/src/registeredIdentityReconciliation.mjs");
  assert.deepEqual(authorizeIdentityReconciliation({ authenticated: true, adminAllowed: true }), { allowed: true, status: 200 });
});

test("registered identity reconciliation refuses a non-administrator", async () => {
  const { authorizeIdentityReconciliation } = await import("../drive-gateway/src/registeredIdentityReconciliation.mjs");
  const result = authorizeIdentityReconciliation({ authenticated: true, adminAllowed: false });
  assert.equal(result.allowed, false);
  assert.equal(result.status, 403);
});

test("registered identity reconciliation matches exact normalized emails and never overwrites existing UIDs", async () => {
  const { classifyRegisteredIdentityRecord } = await import("../drive-gateway/src/registeredIdentityReconciliation.mjs");
  const users = [{ uid: "uid-a", email: "member@example.org" }, { uid: "uid-b", email: "other@example.org" }];
  assert.deepEqual(classifyRegisteredIdentityRecord({ email: " Member@Example.org ", authUsers: users }), {
    status: "assigned", uid: "uid-a", reason: "Assigned the unique existing Firebase Authentication UID for the exact normalized email."
  });
  const conflict = classifyRegisteredIdentityRecord({ email: "different@example.org", existingUid: "uid-a", authUsers: users });
  assert.equal(conflict.status, "conflicting");
  assert.equal(conflict.uid, undefined);
  assert.match(conflict.reason, /UID email does not exactly match/);
});

test("registered identity reconciliation renders a result line per record and a summary", async () => {
  const [worker, policy, members, settings, client] = await Promise.all([
    read("../drive-gateway/src/index.js"),
    read("../drive-gateway/src/registeredIdentityReconciliation.mjs"),
    read("../src/pages/Members.jsx"),
    read("../src/pages/Settings.jsx"),
    read("../src/firebase/registeredIdentityReconciliation.js")
  ]);
  assert.match(worker, /api\/members\/reconcile-registered-identity-uids/);
  assert.match(worker, /results\.push\(line\)/);
  assert.match(worker, /summarizeIdentityReconciliation\(results\)/);
  assert.match(policy, /existingUid/);
  assert.match(members, /uidResults\.map/);
  assert.match(members, /uidResults\.length>0/);
  assert.match(settings, /result\.results\|\|\[\]/);
  assert.match(client, /Step .* failed:/);
});


test("signing authority updates use the Worker and retain register-based authorization", async () => {
  const [worker, client] = await Promise.all([
    read("../drive-gateway/src/index.js"),
    read("../src/firebase/signerIdentity.js")
  ]);
  assert.match(worker, /api\/signature\/authority/);
  const route = worker.slice(worker.indexOf("async function updateSignerAuthorityRoute"), worker.indexOf("async function reconcileRegisteredIdentityUidsRoute"));
  assert.match(route, /Firebase authentication/);
  assert.match(route, /activeRecords\.flatMap\(valuesFor\)\.includes\(requestedRole\)/);
  assert.match(route, /authoritySourceCollection/);
  assert.match(route, /UPDATE_SIGNER_AUTHORITY/);
  assert.match(route, /step\+' failed: '/);
  assert.match(client, /\/api\/signature\/authority/);
  assert.doesNotMatch(client, /httpsCallable\(getFunctions\(undefined,"us-central1"\),"updateSignerAuthority"\)/);
  assert.doesNotMatch(client, /if\(code!=="functions\/not-found"/);
});
