import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const start = source.indexOf("async function upload(request, env) {");
const end = source.indexOf("\nasync function uploadControlledDocument", start);
assert.notEqual(start, -1, "upload handler must exist");
assert.notEqual(end, -1, "upload handler boundary must exist");
const upload = source.slice(start, end);

test("Communication Media is an explicit archive purpose and passes the purpose gate", () => {
  assert.match(upload, /purpose === "Signed Documents Archive" \|\| purpose === "Documents Portal" \|\| purpose === "Controlled Documents" \|\| purpose === "Communication Media"/);
});

test("Communication Media caller authorization remains before archive-folder validation", () => {
  const roleGate = upload.indexOf('purpose === "Communication Media" && !(await authorizeCommunicationMediaDownload(env, claims))');
  const purposeGate = upload.indexOf('purpose === "Signed Documents Archive" || purpose === "Documents Portal"');
  assert.ok(roleGate >= 0 && purposeGate > roleGate);
  assert.match(upload, /Your registered IRPA role does not permit communications media uploads/);
});

test("unlisted purposes with a supplied folder remain rejected with the existing HTTP 400 error", () => {
  assert.match(upload, /else if \(requestedFolderId \|\| data\.ownerUid\) \{\s*return json\(\{ ok: false, error: "Folder parameters are restricted to authorized IRPA archive uploads\." \}, 400/);
});

test("Communication Media still rejects folders that are not the designated IRPA archive", () => {
  assert.match(upload, /folderDescription\.irpaCommunicationMediaArchive !== true \|\| folderDescription\.purpose !== "IRPA Communication and Media Archive"/);
  assert.match(upload, /The requested folder is not the authorised IRPA Communication and Media Archive/);
});
