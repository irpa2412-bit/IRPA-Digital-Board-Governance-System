import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ui=readFileSync(new URL("../src/pages/Invitations.jsx",import.meta.url),"utf8");
const data=readFileSync(new URL("../src/firebase/data.js",import.meta.url),"utf8");
const functions=readFileSync(new URL("../functions/index.js",import.meta.url),"utf8");
const worker=readFileSync(new URL("../drive-gateway/src/index.js",import.meta.url),"utf8");
test("Invitation Register uses the authenticated Cloudflare removal API without a Firebase callable fallback",()=>{
 assert.match(ui,/removeInvitationRecord\(i\.id\)/);
 assert.match(data,/\/api\/invitations\/remove/);
 assert.doesNotMatch(data,/httpsCallable\(getFunctions\(undefined,"us-central1"\),"removeInvitationRecord"\)/);
 assert.doesNotMatch(ui,/deleteRecord\(COLLECTIONS\.invitations,i\.id\)/);
 assert.match(worker,/pathname === "\/api\/invitations\/remove"/);
});
test("server removal requires authenticated active administrator authority",()=>{
 assert.match(functions,/exports\.removeInvitationRecord\s*=\s*onCall/);
 assert.match(functions,/if\(!actor\?\.uid\).*unauthenticated/s);
 assert.match(functions,/if\(!activeAdmin\).*permission-denied/s);
 assert.match(worker,/Only an active IRPA Administrator can remove invitation records/);
});
test("removal preserves activated identities and meeting-linked access controls",()=>{
 assert.match(functions,/accountActivated===true.*activated.*accepted/s);
 assert.match(functions,/meetingId\|\|.*meeting participant/s);
 assert.match(functions,/tx\.delete\(ref\)/);
 assert.match(functions,/INVITATION_REGISTER_REMOVE/);
 assert.match(functions,/tx\.set\(auditRef/);
 assert.match(ui,/Activated — removal restricted/);
});
