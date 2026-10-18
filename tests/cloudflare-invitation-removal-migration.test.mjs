import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("invitation removal is routed to Cloudflare with no callable fallback", async () => {
 const client=await readFile(new URL("../src/firebase/data.js",import.meta.url),"utf8");
 const start=client.indexOf("export async function removeInvitationRecord(invitationId){");
 const end=client.indexOf("\n}",start)+2;
 assert.notEqual(start,-1);assert.ok(end>start);
 const fn=client.slice(start,end);
 assert.match(fn,/\/api\/authorisation\/invitations\/remove/);
 assert.doesNotMatch(fn,/httpsCallable|getFunctions/);
 assert.match(fn,/No Firebase callable fallback was used/);
});

test("Cloudflare invitation removal protects meeting-linked and activated identities and atomically audits deletion", async () => {
 const worker=await readFile(new URL("../drive-gateway/src/index.js",import.meta.url),"utf8");
 assert.match(worker,/pathname === "\/api\/authorisation\/invitations\/remove"/);
 assert.match(worker,/Only an active IRPA Administrator can remove invitation records/);
 assert.match(worker,/meeting participant/);
 assert.match(worker,/activated account/);
 assert.match(worker,/documents:commit/);
 assert.match(worker,/INVITATION_REGISTER_REMOVE/);
});
