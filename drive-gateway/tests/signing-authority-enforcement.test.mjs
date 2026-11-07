import test from "node:test";
import assert from "node:assert/strict";
import { applySigningAuthorityEnforcement } from "../src/signingAuthorityEnforcement.mjs";

const rejected=()=>Object.assign(new Error("register status is not Active"),{status:403,authorityStatusValue:"Suspended",authorityReason:"record found but status is inactive"});

test("default shadow mode audits the would-be rejection and permits legacy signing",async()=>{
  const audit=[],warnings=[];
  const result=await applySigningAuthorityEnforcement({
    env:{},user:{uid:"signer-1"},manualAuthorityIdentification:"Board Member",documentId:"DOC-42",
    verify:async()=>{throw rejected();},
    recordAudit:async entry=>audit.push(entry),
    logger:{warn:(message,entry)=>warnings.push({message,entry})}
  });
  assert.equal(result.verified,false);
  assert.equal(result.shadowAllowed,true);
  assert.equal(result.verificationMethod,"AUTHORITY_ENFORCEMENT_SHADOW");
  assert.deepEqual(audit,[{documentId:"DOC-42",signerUid:"signer-1",statusValue:"Suspended",reason:"record found but status is inactive"}]);
  assert.equal(warnings.length,1);
});

test("enforce mode rejects the same would-be authority rejection without shadow allowance",async()=>{
  let audited=false;
  await assert.rejects(
    applySigningAuthorityEnforcement({
      env:{AUTHORITY_ENFORCEMENT:"enforce"},user:{uid:"signer-1"},documentId:"DOC-42",
      verify:async()=>{throw rejected();},
      recordAudit:async()=>{audited=true;}
    }),
    error=>error.status===403&&error.message==="register status is not Active"
  );
  assert.equal(audited,false);
});

test("non-policy verification failures remain fail-closed in shadow mode",async()=>{
  await assert.rejects(
    applySigningAuthorityEnforcement({env:{},user:{uid:"signer-1"},verify:async()=>{throw Object.assign(new Error("Firestore unavailable"),{status:503});},recordAudit:async()=>{}}),
    error=>error.status===503
  );
});
