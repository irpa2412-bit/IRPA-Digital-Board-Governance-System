import test from "node:test";
import assert from "node:assert/strict";
import {resolveEnvelopeFinalisationEnvironment,retryCompletion} from "../src/signing.mjs";

function fixture({worker="production",envelope="TRIAL",source="TRIAL",externalReference="IRPA-ENV-TEST"}={}){
 const ctx={env:{IRPA_ENVIRONMENT:worker},resolveEnvelopeDataEnvironment:async(reference,ownerUid)=>{
  assert.equal(reference,externalReference);
  assert.equal(ownerUid,"owner-1");
  return source;
 }};
 return {ctx,envelope:{id:"ENV-GATEWAY-1",externalReference,createdBy:"owner-1",dataEnvironment:envelope}};
}

test("production Gateway accepts a TRIAL envelope only when its source draft verifies as TRIAL",async()=>{
 const {ctx,envelope}=fixture();
 assert.equal(await resolveEnvelopeFinalisationEnvironment(ctx,envelope),"TRIAL");
});

test("production Gateway accepts ACTUAL only when its source draft verifies as PRODUCTION",async()=>{
 const {ctx,envelope}=fixture({envelope:"ACTUAL",source:"ACTUAL"});
 assert.equal(await resolveEnvelopeFinalisationEnvironment(ctx,envelope),"ACTUAL");
});

test("production Gateway rejects a source-draft/envelope environment mismatch",async()=>{
 const {ctx,envelope}=fixture({envelope:"ACTUAL",source:"TRIAL"});
 await assert.rejects(()=>resolveEnvelopeFinalisationEnvironment(ctx,envelope),error=>error.status===409&&/verified source draft/.test(error.message));
});

test("staging Gateway cannot finalise an ACTUAL envelope even when its source draft is marked ACTUAL",async()=>{
 const {ctx,envelope}=fixture({worker:"staging",envelope:"ACTUAL",source:"ACTUAL"});
 await assert.rejects(()=>resolveEnvelopeFinalisationEnvironment(ctx,envelope),error=>error.status===409&&/permitted data environment/.test(error.message));
});

test("production Gateway does not accept an unlinked legacy TRIAL envelope",async()=>{
 const {ctx,envelope}=fixture({externalReference:null});
 await assert.rejects(()=>resolveEnvelopeFinalisationEnvironment(ctx,envelope),error=>error.status===409&&/active data environment/.test(error.message));
});


test("owner finalisation command refuses a CompletionFailed envelope while any required signer is unsigned",async()=>{
 const envelope={id:"ENV-OWNER-RETRY-1",createdBy:"owner-1",status:"CompletionFailed",signers:[{id:"S1",status:"Signed"},{id:"S2",status:"Pending"}],events:[]};
 const ctx={meta:{get:async()=>envelope}};
 await assert.rejects(()=>retryCompletion(ctx,{uid:"owner-1"},envelope.id),error=>error.status===409&&/every required signer has signed/.test(error.message));
});

test("owner finalisation command refuses a CompletionFailed envelope with an invalid audit chain",async()=>{
 const envelope={id:"ENV-OWNER-RETRY-2",createdBy:"owner-1",status:"CompletionFailed",signers:[{id:"S1",status:"Signed"}],events:[{hash:"not-a-valid-chain"}]};
 const ctx={meta:{get:async()=>envelope}};
 await assert.rejects(()=>retryCompletion(ctx,{uid:"owner-1"},envelope.id),error=>error.status===409&&/audit chain failed verification/.test(error.message));
});

test("only the document owner may issue the owner finalisation command",async()=>{
 const envelope={id:"ENV-OWNER-RETRY-3",createdBy:"owner-1",status:"CompletionFailed",signers:[{id:"S1",status:"Pending"}],events:[]};
 const ctx={meta:{get:async()=>envelope}};
 await assert.rejects(()=>retryCompletion(ctx,{uid:"other-user"},envelope.id),error=>error.status===403);
});


test("ownerUid and createdByUid identities are recognised for the finalisation command",async()=>{
 for(const field of ["ownerUid","createdByUid"]){
  const envelope={id:"ENV-OWNER-ALIAS-"+field,createdBy:"someone-else",status:"CompletionFailed",[field]:"owner-1",signers:[{id:"S1",status:"Pending"}],events:[]};
  const ctx={meta:{get:async()=>envelope}};
  await assert.rejects(()=>retryCompletion(ctx,{uid:"owner-1"},envelope.id),error=>error.status===409&&/every required signer has signed/.test(error.message));
 }
});
