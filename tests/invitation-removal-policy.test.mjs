import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync(new URL("../src/pages/Invitations.jsx", import.meta.url), "utf8");
const data = readFileSync(new URL("../src/firebase/data.js", import.meta.url), "utf8");
const functions = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");

test("Invitation Register routes removal through the authenticated server callable", () => {
  assert.match(ui, /removeInvitationRecord\(i\.id\)/);
  assert.match(data, /httpsCallable\(getFunctions\(undefined,"us-central1"\),"removeInvitationRecord"\)/);
  assert.doesNotMatch(ui, /deleteRecord\(COLLECTIONS\.invitations,i\.id\)/);
});

test("server removal fails closed for unauthenticated and non-admin callers", () => {
  assert.match(functions, /exports\.removeInvitationRecord\s*=\s*onCall/);
  assert.match(functions, /if\(!actor\?\.uid\).*unauthenticated/s);
  assert.match(functions, /if\(!activeAdmin\).*permission-denied/s);
});

test("removal retains activated identities and meeting-linked access controls", () => {
  assert.match(functions, /accountActivated===true.*activated.*accepted/s);
  assert.match(functions, /meeting-linked invitees from orphaned access|meetingId\|\|.*meeting participant/s);
  assert.match(functions, /tx\.delete\(ref\)/);
  assert.match(functions, /INVITATION_REGISTER_REMOVE/);
  assert.match(functions, /tx\.set\(auditRef/);
  assert.match(ui, /Activated — removal restricted/);
});
