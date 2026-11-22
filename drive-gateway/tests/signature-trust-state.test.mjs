import assert from "node:assert/strict";
import test from "node:test";
import {SIGNATURE_STATES,assertTransition,canTransition,buildAuthorityAssertion,isAuthorityActive,normalizeSigningIdentity} from "../src/signatureTrust/index.mjs";

test("signature lifecycle allows the protected happy path",()=>{
  assert.equal(canTransition(SIGNATURE_STATES.DRAFT,SIGNATURE_STATES.PREPARED),true);
  assert.equal(canTransition(SIGNATURE_STATES.PREPARED,SIGNATURE_STATES.AUTHORITY_VERIFIED),true);
  assert.equal(canTransition(SIGNATURE_STATES.AUTHORITY_VERIFIED,SIGNATURE_STATES.SIGNATURE_REQUESTED),true);
  assert.equal(canTransition(SIGNATURE_STATES.FULLY_SIGNED,SIGNATURE_STATES.CRYPTOGRAPHICALLY_SEALED),true);
  assert.equal(canTransition(SIGNATURE_STATES.CERTIFIED,SIGNATURE_STATES.POST_SIGNATURE),true);
  assert.equal(canTransition(SIGNATURE_STATES.POST_SIGNATURE,SIGNATURE_STATES.FINAL_ARCHIVE),true);
});
test("signature lifecycle rejects a signing bypass",()=>{
  assert.equal(canTransition(SIGNATURE_STATES.DRAFT,SIGNATURE_STATES.FULLY_SIGNED),false);
  assert.throws(()=>assertTransition(SIGNATURE_STATES.DRAFT,SIGNATURE_STATES.FULLY_SIGNED),/Invalid signature transition/);
  assert.throws(()=>assertTransition(SIGNATURE_STATES.FINAL_ARCHIVE,SIGNATURE_STATES.DRAFT),/Terminal signature state/);
});
test("authority assertion requires an institutional identity and source",()=>{
  const identity=normalizeSigningIdentity({uid:"u1",email:"USER@IRPA.OR.TZ",name:"User",profileType:"Employee",department:"Finance",roles:["Finance","Finance"]});
  assert.equal(identity.email,"user@irpa.or.tz");
  assert.deepEqual(identity.roles,["Finance"]);
  const assertion=buildAuthorityAssertion({identity,authoritySource:"DEPARTMENT",authorityReference:"FIN-2026-01",effectiveAt:"2026-01-01T00:00:00Z",expiresAt:"2027-01-01T00:00:00Z",scope:["Finance","Finance"]});
  assert.deepEqual(assertion.scope,["Finance"]);
  assert.equal(isAuthorityActive(assertion,new Date("2026-10-07T00:00:00Z")),true);
  assert.equal(isAuthorityActive(assertion,new Date("2027-02-01T00:00:00Z")),false);
});
