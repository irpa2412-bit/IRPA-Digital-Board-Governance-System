import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ui = await readFile(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
const gateway = await readFile(new URL("../drive-gateway/src/index.js", import.meta.url), "utf8");

test("My Documents deletion removes only the selected row", () => {
  assert.match(ui, /await deleteMySignedDocumentCopy\(d\.id\);setSignedDocuments\(current=>current\.filter\(item=>item\.id!==d\.id\)\)/);
  assert.doesNotMatch(ui, /await deleteMySignedDocumentCopy\(d\.id\);const archived=await getMySignedDocuments\(\);setSignedDocuments\(archived\)/);
});

test("personal-copy deletion trashes only the dedicated Drive copy and retains its audit record", () => {
  const start = gateway.indexOf("async function deleteMySignatureCopy(request, env)");
  const end = gateway.indexOf("\nasync function deleteDriveFile", start);
  assert.ok(start >= 0 && end > start, "delete handler must exist");
  const handler = gateway.slice(start, end);
  assert.match(handler, /method:"PATCH"/);
  assert.match(handler, /body:JSON\.stringify\(\{trashed:true\}\)/);
  assert.doesNotMatch(handler, /method:"DELETE"/);
  assert.match(handler, /personalCopyDeleted:\{booleanValue:true\}/);
  assert.match(handler, /personalCopyDeletedAt:\{timestampValue:deletedAt\}/);
  assert.match(handler, /personalCopyDeletedByUid:\{stringValue:String\(access\.claims\.user_id\)\}/);
  assert.match(handler, /authoritativeDocumentRetained:true,auditTrailRetained:true/);
});

test("revoked transaction dismissal is list-only and preserves the audit record", () => {
  assert.match(ui, /function hideRevokedEnvelope\(envelope\)/);
  assert.match(ui, /immutable audit events, signature evidence and completed documents will be retained/);
  assert.match(ui, /setHiddenRevokedEnvelopeIds\(current=>/);
  assert.match(ui, /envelopes\.filter\(envelope=>!hiddenRevokedEnvelopeIds\.includes\(envelope\.id\)\)/);
  assert.match(ui, /liveClosed&&<button/);
  assert.match(ui, /Remove revoked record/);
});
