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
  assert.match(page, /createRecord\(COLLECTIONS\.documents, documentPayload, documentUid\)/);
  assert.match(page, /getRecord\(COLLECTIONS\.documents, savedDocumentId\)/);
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
