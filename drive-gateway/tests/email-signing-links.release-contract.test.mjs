import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=path=>fs.readFileSync(new URL(path,import.meta.url),"utf8");
const signing=read("../src/signing.mjs");
const router=read("../src/router.mjs");
const index=read("../src/index.js");
const app=read("../../src/App.jsx");
const page=read("../../src/pages/EmailSigningReadOnlyPage.jsx");
const storage=read("../../src/firebase/signatureStorage.js");
const mail=read("../src/invitationEmail.mjs");

test("public email-link routes return the invited signer's fields and associated PDF only",()=>{
  assert.match(router,/\/api\/sign\/email\/open/);
  assert.match(router,/\/api\/sign\/email\/pdf/);
  assert.match(signing,/return \{ok:true,title:preview\.title,ownerName:preview\.ownerName,linkExpiresAt:preview\.linkExpiresAt\}/);
  assert.match(router,/genericEmailSigningFailure\(\)/);
  assert.match(page,/\/api\/sign\/email\/open/);
  assert.match(page,/\/api\/sign\/email\/pdf/);
  assert.doesNotMatch(page,/\/api\/documents\/|\/api\/envelopes\//);
});

test("guest signing page is routed before account authentication and submits only the invited assignment",()=>{
  assert.match(app,/emailSignToken/);
  assert.ok(app.indexOf("emailSigningToken=params.get")<app.indexOf("if(!user)return <AuthScreen/>"));
  assert.match(page,/Read-only controlled document/);
  assert.doesNotMatch(page,/signature-pad|consent|submitSignature|\/api\/sign\/submit/);
});

test("email-link signing does not consult IRPA register or authority matrix",()=>{
  assert.match(index,/for\(const collectionName of \["members","employees"\]\)/);
  assert.match(index,/getFirestoreDocumentsByField\(env,collectionName,"email",normalized,adminToken\)/);
  assert.match(index,/gatewayAuthorityCandidates\(profile\)/);
  assert.match(index,/normalizeGatewayAuthority\(requestedAuthorityRole\)/);
  assert.match(signing,/ctx\.verifyEmailSignerAuthority\?\.\(email,s\?\.authorityRole\|\|""\)/);
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
  assert.match(index,/sendEmailSigningInvitation/);
  assert.match(index,/SMTP_PASSWORD/);
  assert.match(mail,/const text=/);
  assert.match(mail,/const html=/);
});

test("owner resend rotates the link and revoke is routed without changing login signer routes",()=>{
  assert.ok(router.includes(String.raw`invitations\/(S\d{1,2})\/resend`));
  assert.ok(router.includes(String.raw`invitations\/(S\d{1,2})\/revoke`));
  assert.match(signing,/emailLinkTokenHistory/);
  assert.match(signing,/email_link\.resent/);
  assert.match(signing,/email_link\.revoked/);
  assert.match(router,/pathname==="\/api\/sign\/open"/);
  assert.match(router,/pathname==="\/api\/sign\/submit"/);
});
