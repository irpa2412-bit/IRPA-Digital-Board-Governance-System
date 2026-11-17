import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const portal=fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx",import.meta.url),"utf8");
const storage=fs.readFileSync(new URL("../src/firebase/signatureStorage.js",import.meta.url),"utf8");
const gateway=fs.readFileSync(new URL("../drive-gateway/src/signing.mjs",import.meta.url),"utf8");

test("registered member and employee assignments are routed through email-link identity",()=>{
  const registered=portal.match(/if\(registered\)\{([\s\S]*?)\}else\{/);
  assert.ok(registered,"registered signer branch must remain explicit");
  assert.match(registered[1],/identityType:"email-link"/);
});

test("document owner signing uses the same email-link invitation path",()=>{
  assert.match(portal,/documentOwner=useMemo\(\(\)=>\(\{uid:auth\.currentUser\?\.uid,identityType:"email-link"/);
  assert.match(portal,/ownerSigningEnabled\?\[\{\.\.\.documentOwner,optionalSigning:false,actionRequired:true\}\]:\[\]/);
});

test("all workflow recipients and their assigned PDF fields are sent to the Gateway",()=>{
  assert.match(portal,/const emailLinkRecipients=workflowRecipients\.map\(recipient=>\(\{\.\.\.recipient,identityType:"email-link"\}\)\)/);
  assert.match(portal,/recipients:emailLinkRecipients,fields\}/);
  assert.match(storage,/recipient\.uid/);
  assert.match(storage,/signerAssignmentByKey/);
  assert.match(storage,/signerId:resolveSignerId\(field\)/);
});

test("Gateway email-link signing is independent of Firebase UID authentication",()=>{
  assert.match(gateway,/if\(s0\.identityType==="email-link"\)\{if\(s0\.emailLinkStatus!=="opened"\)/);
  assert.match(gateway,/emailLink\?\$\{ctx\.config\.appUrl\}\/\?emailSignToken=/);
});
