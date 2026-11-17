import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=path=>fs.readFileSync(new URL(path,import.meta.url),"utf8");
const signing=read("../src/signing.mjs");
const router=read("../src/router.mjs");
const app=read("../../src/App.jsx");
const page=read("../../src/pages/EmailSigningReadOnlyPage.jsx");
const storage=read("../../src/firebase/signatureStorage.js");
const portal=read("../../src/pages/SignaturePlatform.jsx");
const documentReader=read("../../src/components/DocumentReader.jsx");
const translation=read("../../src/components/DocumentTranslationWorkspace.jsx");
const pathwaySelfTest=read("../../src/components/SignaturePathwaySelfTest.jsx");
const gatewayPortal=read("../../src/pages/GatewaySigningPortal.jsx");
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
  assert.match(page,/Complete document review/);
  assert.ok(page.includes("pdfjsLib.getDocument({data:bytes.slice()})"));
  assert.match(page,/STAMP APPLIED/);
  assert.match(page,/Review complete document and signature placement/);
  assert.match(page,/You may still revoke this request/);
  assert.match(page,/Your declaration for this document/);
  assert.match(page,/Submit/);
  assert.match(page,/Revoke/);
  assert.ok(page.includes("/api/sign/decline"));
  assert.doesNotMatch(page,/<iframe/);
  assert.match(page,/\/api\/sign\/submit/);
  assert.match(page,/credentials:"omit"/);
  assert.doesNotMatch(page,/verifyManualSigningAuthority|manualAuthorityIdentification/);
  assert.match(storage,/signerId:resolveSignerId\(field\)/);
});

test("email-link identity is transaction-scoped and does not require a register or authority matrix lookup",()=>{
  assert.doesNotMatch(signing,/verifyEmailSignerAuthority/);
  assert.match(signing,/identityType==="email-link"/);
  assert.match(signing,/signer\.emailLinkStatus==="opened"/);
  assert.match(signing,/else assertSignerAuthentication\(s0,user\)/);
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

test("PDF.js receives independent byte buffers for the signing viewer and owner integrity panel",()=>{
  assert.ok(portal.includes("source={data:bytes.slice()}"));
  assert.ok(portal.includes("pdfjsLib.getDocument({data:bytes.slice()}).promise"));
  assert.ok(page.includes("pdfjsLib.getDocument({data:bytes.slice()})"));
});
test("signer must review the rendered document and applied stamps before submit or revoke",()=>{
  assert.match(page,/Review complete document and signature placement/);
  assert.match(page,/Final review — signature not yet submitted/);
  assert.match(page,/Navigate through every page above/);
  assert.match(page,/Your signature has not been submitted yet/);
  assert.match(page,/Changes to assigned fields update this preview/);
  assert.doesNotMatch(page,/Return to editing/);
  assert.ok(!page.includes("disabled={reviewMode||signingClosed}"));
  assert.match(signing,/email_link\.revoked_by_signer/);
  assert.match(signing,/emailLinkStatus="revoked"/);
});

test("all application PDF.js entry points copy caller-owned bytes before worker transfer",()=>{
  assert.equal(documentReader.split("pdfjsLib.getDocument({data:bytes.slice()})").length-1,2);
  assert.ok(translation.includes("pdfjsLib.getDocument({data:bytes.slice()}).promise"));
  assert.ok(pathwaySelfTest.includes("pdfjsLib.getDocument({ data: bytes.slice() }).promise"));
  assert.ok(gatewayPortal.includes("pdfjsLib.getDocument({data:bytes.slice()})"));
  assert.ok(portal.includes("source={data:bytes.slice()}"));
  assert.ok(portal.includes("pdfjsLib.getDocument({data:bytes.slice()}).promise"));
});
