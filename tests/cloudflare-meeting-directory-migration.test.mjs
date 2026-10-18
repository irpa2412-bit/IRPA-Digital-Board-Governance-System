import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("meeting invitee directory no longer calls Firebase Functions", async () => {
  const client=await readFile(new URL("../src/firebase/data.js",import.meta.url),"utf8");
  const start=client.indexOf("export async function listMeetingInviteeDirectory(){");
  const end=client.indexOf("\n}",start)+2;
  assert.notEqual(start,-1);assert.ok(end>start);
  const fn=client.slice(start,end);
  assert.match(fn,/\/api\/meeting\/invitee-directory/);
  assert.match(fn,/getIdToken\(\)/);
  assert.doesNotMatch(fn,/httpsCallable|getFunctions/);
});

test("meeting invitee directory is authenticated and returns only active register entries", async () => {
  const worker=await readFile(new URL("../drive-gateway/src/index.js",import.meta.url),"utf8");
  assert.match(worker,/pathname === "\/api\/meeting\/invitee-directory"/);
  assert.match(worker,/authenticateFirebaseRequest\(request, env\)/);
  assert.match(worker,/\["active","activated"\]/);
  assert.match(worker,/boardMembers:projectRows\(members,"board"\)/);
});
