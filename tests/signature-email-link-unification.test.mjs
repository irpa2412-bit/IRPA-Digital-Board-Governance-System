import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const portal=fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx",import.meta.url),"utf8");
const storage=fs.readFileSync(new URL("../src/firebase/signatureStorage.js",import.meta.url),"utf8");
const gateway=fs.readFileSync(new URL("../drive-gateway/src/signing.mjs",import.meta.url),"utf8");
const emailPage=fs.readFileSync(new URL("../src/pages/EmailSigningReadOnlyPage.jsx",import.meta.url),"utf8");
const invitation=fs.readFileSync(new URL("../drive-gateway/src/invitationEmail.mjs",import.meta.url),"utf8");

test("registered member and employee assignments retain authenticated account identity",()=>{
  const registered=portal.match(/if\(registered\)\{([\s\S]*?)\}else\{/);
  assert.ok(registered,"registered signer branch must remain explicit");
  assert.match(registered[1],/identityType:"account"/);
  assert.match(registered[1],/uid:registered\.uid/);
  assert.match(registered[1],/occupation:signerAuthorityRole\.trim\(\)/);
});

test("document owner is an authenticated account signer only when explicitly enabled",()=>{
  assert.match(portal,/documentOwner=useMemo\(\(\)=>\(\{uid:auth\.currentUser\?\.uid,identityType:"account"/);
  assert.match(portal,/ownerSigningEnabled\?\[\{\.\.\.documentOwner,optionalSigning:false,actionRequired:true\}\]:\[\]/);
  assert.match(portal,/if\(ownerSigningEnabled&&!fields\.some/);
});

test("all workflow recipients preserve account or email-link identity and assigned PDF fields reach the Gateway",()=>{
  assert.match(portal,/const gatewayRecipients=workflowRecipients\.map\(recipient=>\(\{\.\.\.recipient,identityType:recipient\.identityType==="email-link"\?"email-link":"account"\}\)\)/);
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

test("staging and production Gateway envelopes accept only email-link guests without UID or authenticated account signers with UID",()=>{
  assert.match(gateway,/const emailLink=s\?\.identityType==="email-link"&&!s\?\.uid/);
  assert.match(gateway,/const account=s\?\.identityType==="account"&&typeof s\?\.uid==="string"&&s\.uid\.trim\(\)\.length>0/);
  assert.match(gateway,/return !emailLink&&!account/);
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
