import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const portal=fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx",import.meta.url),"utf8");
const platform=fs.readFileSync(new URL("../src/firebase/signaturePlatform.js",import.meta.url),"utf8");
const worker=fs.readFileSync(new URL("../drive-gateway/src/index.js",import.meta.url),"utf8");
const storage=fs.readFileSync(new URL("../src/firebase/signatureStorage.js",import.meta.url),"utf8");
const gateway=fs.readFileSync(new URL("../drive-gateway/src/signing.mjs",import.meta.url),"utf8");
const emailPage=fs.readFileSync(new URL("../src/pages/EmailSigningReadOnlyPage.jsx",import.meta.url),"utf8");
const invitation=fs.readFileSync(new URL("../drive-gateway/src/invitationEmail.mjs",import.meta.url),"utf8");

test("registered member and employee assignments are serialized to Gateway as email-link identities",()=>{
  const registered=portal.match(/if\(registered\)\{([\s\S]*?)\}else\{/);
  assert.ok(registered,"registered signer branch must remain explicit");
  assert.match(portal,/const recipientEmail=email/);
  assert.match(portal,/test\(recipientEmail\)/);
  assert.match(registered[1],/email:recipientEmail/);
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
  assert.match(portal,/recipients:orderedRecipients,fields,ownerSigningEnabled/);
  assert.match(storage,/identityType:"email-link"/);
  assert.match(storage,/signers:ordered\.map\(\(recipient,index\)\s*=>\s*\{/);
  assert.match(storage,/recipient\.uid/);
  assert.match(storage,/signerAssignmentByKey/);
  assert.match(storage,/signerId:resolveSignerId\(field\)/);
});

test("Gateway email-link signing is independent of Firebase UID authentication",()=>{
  assert.match(gateway,/emailLinkSessionStatus==="active"/);
  assert.match(gateway,/SESSION_REQUIRED/);
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
  assert.match(portal,/if\(!selected\.gatewayEnvelopeId\)\{setMessage\("This draft has not been sent[\s\S]*?return;?\}/);
  assert.match(portal,/This envelope must be signed through its verified email-link invitation/);
});

test("the invitation bearer token is consumed once and the signer session survives a page refresh",()=>{
  assert.match(gateway,/sessionToken/);
  assert.match(gateway,/invitationTokenConsumed:false/);
  assert.match(gateway,/email_link\.session_created/);
  assert.match(emailPage,/Open document to sign/);
  assert.match(emailPage,/api\/sign\/email\/session/);
  assert.doesNotMatch(emailPage,/sessionStorage\.getItem\(sessionKey\)/);
  assert.match(emailPage,/x-signing-token":activeToken/);
});

test("email-link possession is not misrepresented as legal identity or institutional authority",()=>{
  assert.match(emailPage,/confirms control of the invited email address/);
  assert.match(emailPage,/does not independently verify your legal identity or authority to bind an organisation/);
  assert.match(emailPage,/delegation or approval process/);
});

test("Signature Profile explicitly presents the email-link e-signature method",()=>{
  assert.ok(portal.includes('<span>Signing method</span><strong>Email-link e-signature</strong>'));
  assert.ok(portal.includes('<h1>{signerOnly?"Signing Invitation":"Email-link E-signature Portal"}</h1>'),"the main Signature Portal heading must identify the email-link signing method");
  assert.ok(portal.includes("unique link")&&portal.includes("secure email-link workflow"));
});

test("owner envelope lifecycle mutations use the authenticated Gateway commit path",()=>{
  assert.match(platform,/mutateSignatureEnvelope\(envelope\.id,"start"/);
  assert.match(platform,/mutateSignatureEnvelope\(envelope\.id,"invitation-sent"/);
  assert.match(platform,/mutateSignatureEnvelope\(envelopeId,"attach-gateway"/);
  assert.match(platform,/await updateDoc\(doc\(db,ENVELOPE_COLLECTION,envelope\.id\),update\)/,"signer completion is a separate path and remains explicitly tracked for migration");
  assert.match(platform,/\/api\/signature-workflow\/mutate/);
  assert.match(worker,/mutateSignatureWorkflowEnvelopeRoute/);
  assert.match(worker,/Only the original envelope owner may perform this operation/);
  assert.match(worker,/Commit authorized envelope mutation and audit event atomically/);
});


test("document owner can manually enter a signer name and email",()=>{
  assert.match(portal,/<label>Signer name<input type="text" value=\{signerName\}/);
  assert.match(portal,/<label>Signer email<input type="email" value=\{signerEmail\}/);
  assert.match(portal,/if\(!registered&&!String\(signerName\|\|""\)\.trim\(\)\)/);
  assert.match(portal,/name:String\(signerName\|\|""\)\.trim\(\),email,role/);
});

test("matching registered signer records are offered for selection without creating duplicates",()=>{
  assert.match(portal,/aria-label="Matching existing IRPA records"/);
  assert.match(portal,/Optional IRPA record lookup — not required/);
  assert.match(portal,/an IRPA register entry is not required to be a signatory/);
  assert.match(portal,/setSelectedSigner\(member\.uid\)/);
  assert.match(portal,/const duplicate=registered\?recipients\.find\(x=>x\.uid===registered\.uid\):null/);
  assert.match(portal,/members\.filter\(member=>String\(member\.email\|\|""\)\.trim\(\)&&member\.uid!==auth\.currentUser\?\.uid&&!recipients\.some\(r=>r\.uid===member\.uid\)/);
  assert.doesNotMatch(portal,/r\.email\|\|""\)\.trim\(\)\.toLowerCase\(\)===String\(member\.email/);
  assert.match(portal,/roleAssignments:\[\.\.\.existingAssignments,assignment\]/);
  assert.match(portal,/sameAssignment=existingAssignments\.some/);
  assert.match(portal,/One email-link identity and invitation covers the responsibilities/);
  assert.match(storage,/roleAssignments:\(Array\.isArray\(recipient\.roleAssignments\)/);
  assert.match(gateway,/roleAssignments:\(Array\.isArray\(s\?\.roleAssignments\)/);
  assert.match(gateway,/roleAssignments:signer\.roleAssignments\|\|\[\]/);
  assert.match(gateway,/roleAssignments:s\.roleAssignments\|\|\[\]/);
  assert.match(platform,/workflowRoleAssignments:Array\.isArray\(recipient\.roleAssignments\)/);
  assert.match(emailPage,/Your assigned responsibilities:/);
});


test("one email-link signer can hold distinct roles or capacities on the same document",()=>{
  assert.match(portal,/const updatedRecipient=\{\.\.\.duplicate,roleAssignments:\[\.\.\.existingAssignments,assignment\]\}/);
  assert.match(portal,/sameAssignment=existingAssignments\.some/);
  assert.match(portal,/setRecipients\(updatedRecipients\)/);
  assert.match(storage,/roleAssignments:/);
  assert.match(gateway,/roleAssignments:/);
  assert.match(emailPage,/record\.signer\?\.roleAssignments/);
});


test("a signer can be assigned separate PDF fields for each role responsibility",()=>{
  assert.match(portal,/selectedRoleAssignmentIndex/);
  assert.match(portal,/roleAssignmentIndex=selectedRoleAssignmentIndex/);
  assert.match(portal,/Responsibility for new fields/);
  assert.match(portal,/Signature responsibility assignment/);
  assert.match(storage,/roleAssignmentIndex:Number\.isInteger\(Number\(field\.roleAssignmentIndex\)\)/);
  assert.match(gateway,/roleAssignmentIndex=f\?\.roleAssignmentIndex==null\?0:Number\(f\.roleAssignmentIndex\)/);
  assert.match(gateway,/Every signer responsibility must have at least one assigned Signature or Initials field/);
  assert.match(gateway,/roleAssignmentEvidence/);
  assert.match(gateway,/signatureFieldHashes\.push/);
  assert.match(gateway,/signer\.role_assignment\.completed/);
});

test("email signing advances the document to the next responsibility after the current assignment is complete",()=>{
  assert.match(emailPage,/activeRoleAssignmentIndex/);
  assert.match(emailPage,/assignmentFields=fields\.filter/);
  assert.match(emailPage,/nextInAssignment/);
  assert.match(emailPage,/nextAssignmentIndex/);
  assert.match(emailPage,/setActiveRoleAssignmentIndex\(nextAssignmentIndex\)/);
  assert.match(emailPage,/Moving to the next signature assignment/);
  assert.match(emailPage,/All assigned responsibilities are complete/);
});
