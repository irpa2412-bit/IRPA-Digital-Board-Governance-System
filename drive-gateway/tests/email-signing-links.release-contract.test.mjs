import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=path=>fs.readFileSync(new URL(path,import.meta.url),"utf8");
const signing=read("../src/signing.mjs");
const router=read("../src/router.mjs");
const app=read("../../src/App.jsx");
const page=read("../../src/pages/EmailSigningReadOnlyPage.jsx");
const storage=read("../../src/firebase/signatureStorage.js");
const mail=read("../src/invitationEmail.mjs");

test("email-link routes return only the invited signer's assigned fields and controlled PDF",()=>{
  assert.match(router,/\/api\/sign\/email\/open/);
  assert.match(router,/\/api\/sign\/email\/pdf/);
  assert.match(signing,/fields:preview\.fields/);
  assert.match(signing,/appliedFields:\[\]/);
  assert.match(signing,/ownerDeclaredParticulars:preview\.ownerDeclaredParticulars/);
  assert.match(router,/genericEmailSigningFailure\(\)/);
  assert.match(page,/\/api\/sign\/email\/open/);
  assert.match(page,/\/api\/sign\/email\/pdf/);
  assert.doesNotMatch(page,/\/api\/documents\/|\/api\/envelopes\//);
});

test("external guest signing page is routed before account authentication and submits through the token-only Gateway path",()=>{
  assert.match(app,/emailSignToken/);
  assert.ok(app.indexOf("emailSigningToken=params.get")<app.indexOf("if(!user)return <AuthScreen/>"));
  assert.match(page,/Controlled document preview/);
  assert.match(page,/Your declaration for this document/);
  assert.match(page,/Confirm and submit my assigned action/);
  assert.match(page,/\/api\/sign\/submit/);
  assert.match(page,/credentials:"omit"/);
  assert.doesNotMatch(page,/verifyManualSigningAuthority|manualAuthorityIdentification/);
  assert.match(storage,/signerId:resolveSignerId\(field\)/);
});

test("email-link identity is transaction-scoped and does not require a register or authority matrix lookup",()=>{
  assert.doesNotMatch(signing,/verifyEmailSignerAuthority/);
  assert.match(signing,/identityType==="email-link"/);
  assert.match(signing,/signer\.emailLinkStatus==="opened"/);
  assert.match(signing,/s0\.identityType!=="email-link"/);
  assert.match(signing,/declarationDiscrepancy/);
});

test("token, IP and envelope mutations use hashes and compare-and-set",()=>{
  assert.match(signing,/sha256Hex\("email-signing-rate:"\+key\)/);
  assert.match(signing,/ctx\.meta\.update\("envelopes",id,patch,\{ifVersion:c\._v\}\)/);
  assert.match(signing,/signer\.emailLinkStatus=opened\.status/);
  assert.match(signing,/emailLinkStatus="revoked"/);
  assert.doesNotMatch(signing,/logger\.(?:info|debug|error)\([^\n]*token\b/i);
});

test("email invitation reuses the existing SMTP retry flow with both text and HTML bodies",()=>{
  assert.match(mail,/sendWithRetry\(\(\)=>smtpSend\(\{to,\.\.\.message\}\)/);
  assert.match(mail,/const text=/);
  assert.match(mail,/const html=/);
});

test("owner resend rotates the link and revoke remains an owner-controlled operation",()=>{
  assert.ok(router.includes(String.raw`invitations\/(S\d{1,2})\/resend`));
  assert.ok(router.includes(String.raw`invitations\/(S\d{1,2})\/revoke`));
  assert.match(signing,/emailLinkTokenHistory/);
  assert.match(signing,/email_link\.resent/);
  assert.match(signing,/email_link\.revoked/);
  assert.match(router,/pathname==="\/api\/sign\/open"/);
  assert.match(router,/pathname==="\/api\/sign\/submit"/);
});
