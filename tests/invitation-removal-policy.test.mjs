import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ui=readFileSync(new URL("../src/pages/Invitations.jsx",import.meta.url),"utf8");
const data=readFileSync(new URL("../src/firebase/data.js",import.meta.url),"utf8");
const gateway=readFileSync(new URL("../drive-gateway/src/invitationRemoval.mjs",import.meta.url),"utf8");
const workflow=readFileSync(new URL("../.github/workflows/firebase-deploy.yml",import.meta.url),"utf8");

test("Invitation Register removal uses the authenticated Cloudflare gateway",()=>{
 assert.match(ui,/removeInvitationRecord\(i\.id\)/);
 assert.match(data,/\/api\/invitations\/remove/);
 assert.match(data,/auth\.currentUser\.getIdToken\(\)/);
 assert.doesNotMatch(data,/httpsCallable\(getFunctions\(undefined,"us-central1"\),"removeInvitationRecord"\)/);
 assert.doesNotMatch(ui,/deleteRecord\(COLLECTIONS\.invitations,i\.id\)/);
});

test("gateway enforces authenticated active-administrator authorization",()=>{
 assert.match(gateway,/authenticateFirebaseRequest\(request, env\)/);
 assert.match(gateway,/tokenPayload\.admin === true/);
 assert.match(gateway,/adminProfiles\//);
 assert.match(gateway,/Only an active IRPA Administrator/);
});

test("gateway preserves activated identities and meeting-linked access controls",()=>{
 assert.match(gateway,/record\.meetingId/);
 assert.match(gateway,/accountActivated === true/);
 assert.match(gateway,/activationCompleted === true/);
 assert.match(gateway,/INVITATION_REGISTER_REMOVE/);
 assert.match(gateway,/currentDocument: \{ updateTime: invitation\.updateTime \}/);
 assert.match(gateway,/documents:commit/);
});

test("Firebase deployment workflow no longer deploys the migrated callable",()=>{
 assert.doesNotMatch(workflow,/Deploy secure invitation removal callable/);
 assert.doesNotMatch(workflow,/functions:removeInvitationRecord/);
 assert.match(workflow,/\/api\/invitations\/remove/);
});
