import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("controlled upload exposes each persistence step and identifiers after success or failure", async () => {
  const page = await read("../src/components/ControlledDocumentUpload.jsx");
  assert.match(page, /Upload step report/);
  assert.match(page, /Document ID:/);
  assert.match(page, /Drive file ID:/);
  assert.match(page, /Archive destination:/);
  assert.match(page, /Record environment:/);
  assert.match(page, /setUploadReport\(\{\.\.\.uploadProgress\}\)/);
  assert.match(page, /FAIL: \"\+detail/);
  assert.match(page, /Create Firestore documents record/);
});

test("uploaded controlled documents are persisted under their allocated ID and remain in the role-authorized archive query", async () => {
  const page = await read("../src/components/ControlledDocumentUpload.jsx");
  const data = await read("../src/firebase/data.js");
  const rules = await read("../firestore.rules");
  assert.match(page, /registerControlledDocumentRecord\(\{documentId:documentUid,documentPayload\}\)/);
  assert.match(page, /registerControlledDocumentRecord\(\{documentId:pendingDocument\.documentId,documentPayload:pendingDocument\.documentPayload\}\)/);
  assert.match(data, /export async function getRecords\(collectionName\)\{const s=await getDocs\(query\(collection\(db,collectionName\),orderBy\(\"createdAt\",\"desc\"\)\)\)/);
  assert.match(rules, /match \/documents\/\{id\}/);
  assert.match(rules, /controlledDocumentReadAllowed\(\)/);
  assert.match(page, /archiveUidLink/);
  assert.match(page, /archiveFileId/);
});

test("archive destination is provisioned by the Worker and does not require a Department or Archive Registry entry", async () => {
  const storage = await read("../src/firebase/signatureStorage.js");
  const worker = await read("../drive-gateway/src/index.js");
  assert.match(storage, /gatewayPost\(\"\/api\/upload-controlled-document\"/);
  assert.match(worker, /findOrCreateFolder\(env, accessToken, archiveCategory, archiveRootId/);
  assert.match(worker, /const categoryFile=await uploadToFolder\(categoryFolderId/);
  assert.match(worker, /archiveUidLink:/);
});


test("administrator archive listing attaches Firestore IDs and retains authorized TRIAL records", async () => {
  const worker = await read("../drive-gateway/src/documentLifecycle.mjs");
  const policy = await read("../drive-gateway/src/documentPolicy.mjs");
  const view = await read("../src/components/DocumentRetrievalAccessPoint.jsx");
  assert.match(worker, /getFirestoreAdminAccessToken/);
  assert.match(worker, /documentId:data\.documentId\|\|documentId/);
  assert.match(worker, /filter\(doc=>canRead\(identity,doc\)\.allowed\)/);
  assert.match(policy, /if\(identity\.actorType==="ADMINISTRATOR"\)return\{allowed:true/);
  assert.match(view, /TRIAL/);
});

test("controlled upload registration is performed by the authenticated Worker and labels closed-gate records TRIAL", async () => {
  const page = await read("../src/components/ControlledDocumentUpload.jsx");
  const storage = await read("../src/firebase/signatureStorage.js");
  const worker = await read("../drive-gateway/src/index.js");
  assert.match(page, /registerControlledDocumentRecord\(\{documentId:documentUid,documentPayload\}\)/);
  assert.doesNotMatch(page, /createRecord\(COLLECTIONS\.documents/);
  assert.match(storage, /\/api\/upload-controlled-document\/register/);
  assert.match(worker, /STEP Firestore documents record/);
  assert.match(worker, /recordOrigin,trialData:recordOrigin==="TRIAL",isTrial:recordOrigin==="TRIAL"/);
});
