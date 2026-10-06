import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("client invitation password setup uses server invitation email and never auth.currentUser.email", ()=>{
  const source=readFileSync(new URL("../../src/firebase/auth.js", import.meta.url),"utf8");
  const start=source.indexOf("export async function configureInvitationPassword");
  const end=source.indexOf("export async function completeInvitationActivation",start);
  assert.ok(start>=0 && end>start);
  const block=source.slice(start,end);
  assert.match(block,/invitationEmail/);
  assert.match(block,/EmailAuthProvider\.credential\(cleanInvitationEmail, cleanPassword\)/);
  assert.match(block,/linkWithCredential\(/);
  assert.doesNotMatch(block,/auth\.currentUser\.email/);
});

test("client invitation session state carries server email into password setup", ()=>{
  const source=readFileSync(new URL("../../src/App.jsx", import.meta.url),"utf8");
  assert.match(source,/invitationEmailForSetup/);
  assert.match(source,/setInvitationEmailForSetup\(invitationSession\.email \|\| null\)/);
  assert.match(source,/configureInvitationPassword\(password, invitationId, invitationEmail\)/);
});
