import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const portal=fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx",import.meta.url),"utf8");
const storage=fs.readFileSync(new URL("../src/firebase/signatureStorage.js",import.meta.url),"utf8");
const gateway=fs.readFileSync(new URL("../drive-gateway/src/signing.mjs",import.meta.url),"utf8");
const emailPage=fs.readFileSync(new URL("../src/pages/EmailSigningReadOnlyPage.jsx",import.meta.url),"utf8");
const invitation=fs.readFileSync(new URL("../drive-gateway/src/invitationEmail.mjs",import.meta.url),"utf8");

test("registered member and employee assignments are serialized to Gateway as email-link identities",()=>{
  const registered=portal.match(/if\(registered\)\{([\s\S]*?)\}else\{/);
  assert.ok(registered,"registered signer branch must remain explicit");
  assert.match(registered[1],/email:registeredEmail/);
  assert.match(storage,/identityType:"email-link"/);
  assert.match(registered[1],/occupation:signerAuthorityRole\.trim\(\)/);
});

test("document owner may be included as an email-link signer when explicitly enabled",()=>{
  assert.match(portal,/documentOwner=useMemo\(\(\)=>\(\{uid:auth\.currentUser\?\.uid,identityType:"account"/);
  assert.match(storage,/identityType:"email-link"/);
  assert.match(portal,/ownerSigningEnabled\?\[\{\.\.\.documentOwner,optionalSigning:false,actionRequired:true\}\]:\[\]/);
  assert.match(portal,/if\(ownerSigningEnabled&&!fields\.some/);
});

test("all workflow recipients become email-link identities and assigned PDF fields reach the Gateway",()=>{
  assert.match(portal,/const gatewayRecipients=workflowRecipients\.map\(recipient=>\(\{\.\.\.recipient,identityType:"email-link"\}\)\)/);
  assert.match(storage,/identityType:"email-link"/);
  assert.match(portal,/recipients:gatewayRecipients,fields\}/);
  assert.match(storage,/recipient\.uid/);
  assert.match(storage,/signerAssignmentByKey/);
  assert.match(storage,/signerId:resolveSignerId\(field\)/);
});

test("Gateway email-link signing is independent of Firebase UID authentication",()=>{
  assert.match(gateway,/if\(s0\.identityType==="email-link"\)\{if\(s0\.emailLinkStatus!=="opened"\)/);
  assert.match(gateway,/emailSignToken=/);
  assert.match(invitation,/single-use link/);
  assert.match(invitation,/signer-specific session/);
});

test("staging and production Gateway envelopes reject every non-email-link signer identity",()=>{
  assert.match(gateway,/input\.some\(s=>s\?\.identityType!=="email-link"\|\|s\?\.uid\)/);
  assert.match(gateway,/Every staging and production signer must use a verified email-link identity/);
  assert.match(gateway,/else assertSignerAuthentication\(s0,user\)/);
});

test("assigned workflow role is not misrepresented as the signer's occupation or capacity",()=>{
  assert.match(storage,/occupation:String\(recipient\.occupation\|\|recipient\.capacity\|\|""\)\.trim\(\)/);
  assert.doesNotMatch(storage,/occupation:String\(recipient\.occupation\|\|recipient\.capacity\|\|recipient\.role/);
});

test("Gateway envelopes cannot be signed through the parallel in-app UID workflow",()=>{
  assert.match(portal,/if\(selected\.gatewayEnvelopeId\)throw new Error\("This envelope must be signed through its email-link invitation/);
});

test("the invitation bearer token is consumed once and the signer session survives a page refresh",()=>{
  assert.match(gateway,/sessionToken/);
  assert.match(gateway,/invitationTokenConsumed:true/);
  assert.match(emailPage,/sessionStorage\.getItem\(sessionKey\)/);
  assert.match(emailPage,/sessionStorage\.setItem\(sessionKey,session\)/);
  assert.match(emailPage,/x-signing-token":activeToken/);
});

test("email-link possession is not misrepresented as legal identity or institutional authority",()=>{
  assert.match(emailPage,/confirms control of the invited email address/);
  assert.match(emailPage,/does not independently verify your legal identity or authority to bind an organisation/);
  assert.match(emailPage,/delegation or approval process/);
});

test("Signature Profile explicitly presents the email-link e-signature method",()=>{
  assert.ok(portal.includes('<span>Signing method</span><strong>Email-link e-signature</strong>'));
  assert.ok(portal.includes("unique link")&&portal.includes("secure email-link workflow"));
});

test("owner envelope lifecycle mutations use the authenticated Gateway commit path",()=>{
  assert.match(platform,/mutateSignatureEnvelope\(envelope\.id,"start"/);
  assert.match(platform,/mutateSignatureEnvelope\(envelope\.id,"invitation-sent"/);
  assert.match(platform,/mutateSignatureEnvelope\(envelopeId,"attach-gateway"/);
  assert.doesNotMatch(platform,/await updateDoc\(doc\(db,\s*ENVELOPE_COLLECTION,\s*envelope\.id\)/);
  assert.match(gateway,/\/api\/signature-workflow\/mutate/);
  assert.match(gateway,/mutateSignatureWorkflowEnvelopeRoute/);
  assert.match(gateway,/Only the original envelope owner may perform this operation/);
  assert.match(gateway,/Commit authorized envelope mutation and audit event atomically/);
});
