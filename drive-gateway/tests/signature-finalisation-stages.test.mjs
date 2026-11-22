import test from "node:test";
import assert from "node:assert/strict";
import {recordFinalisationStage} from "../src/finalisationStages.mjs";
import {distributeCompletedSignatureDocument} from "../src/signatureDistribution.mjs";
import {sha256Hex} from "../src/util.mjs";

const makeMeta=initial=>{let row={...initial,_v:1};return{
 async get(table,id){return table==="envelopes"?{...row}:null;},
 async update(table,id,patch,{ifVersion}={}){assert.equal(ifVersion,row._v);row={...row,...patch,_v:row._v+1};},
 snapshot(){return row;}
};};

for(const stageCode of ["PDF_BUILD","HASH","ARCHIVE","CERTIFICATE","DISTRIBUTION"]){
 test("records "+stageCode+" failure with a sanitised stage record",async()=>{
  const meta=makeMeta({id:"ENV-TEST",status:"CompletionFailed"});
  const ctx={meta,now:()=>new Date("2026-11-22T18:00:00Z"),logger:{error(){}}};
  await assert.rejects(()=>recordFinalisationStage(ctx,"ENV-TEST",stageCode,async()=>{const e=new Error("failed for user@example.org");e.code="E_TEST";throw e;}),/failed for user/);
  const entry=meta.snapshot().finalisationRecord.stages[stageCode];
  assert.equal(entry.status,"FAILED");assert.equal(entry.stageCode,stageCode);assert.equal(entry.errorCode,"E_TEST");
  assert.doesNotMatch(entry.errorMessage,/user@example.org/);
 });
}
test("records successful finalisation stage without changing envelope status",async()=>{
 const meta=makeMeta({id:"ENV-TEST",status:"Finalizing"}),ctx={meta,now:()=>new Date("2026-11-22T18:00:00Z")};
 assert.equal(await recordFinalisationStage(ctx,"ENV-TEST","HASH",async()=>"abc"),"abc");
 assert.equal(meta.snapshot().status,"Finalizing");assert.equal(meta.snapshot().finalisationRecord.stages.HASH.status,"PASS");
});
test("email failure preserves Completed and persists PartiallyFailed distribution",async()=>{
 const bytes=new Uint8Array([1,2,3]),hash=await sha256Hex(bytes);
 let envelope={id:"ENV-TEST",createdBy:"owner",status:"Completed",ownerEmail:"owner@example.org",signers:[{id:"S1",email:"signer@example.org",status:"Signed"}],_v:1};
 const distributions=new Map();
 const meta={
  async get(table,id){return table==="envelopes"?{...envelope}:distributions.has(id)?{...distributions.get(id)}:null;},
  async update(table,id,patch,{ifVersion}={}){if(table==="envelopes"){assert.equal(ifVersion,envelope._v);envelope={...envelope,...patch,_v:envelope._v+1};}else{const row=distributions.get(id);assert.equal(ifVersion,row._v);distributions.set(id,{...row,...patch,_v:row._v+1});}},
  async create(table,id,value){distributions.set(id,{...value,_v:1});},
  async list(){return [...distributions.values()].map(row=>({...row}));}
 };
 const ctx={meta,storage:{async get(){return bytes;}},now:()=>new Date("2026-11-22T18:00:00Z"),sendCompletionEmail:async({to})=>{if(to==="signer@example.org"){const e=new Error("SMTP rejected");e.stageCode="SUBMIT";e.smtpReplyCategory="RECIPIENT_REJECTED";throw e;}return{messageId:"accepted"};},logger:{error(){}}};
 const summary=await distributeCompletedSignatureDocument(ctx,envelope,{primaryStorageId:"pdf",finalHash:hash,fileName:"signed.pdf"},{bytes});
 assert.equal(envelope.status,"Completed");assert.equal(envelope.distributionStatus,"PartiallyFailed");assert.equal(summary.status,"PartiallyFailed");
 assert.equal(summary.sent,1);assert.equal(summary.failed,1);
 const failed=summary.deliveries.find(row=>row.status==="Failed");
 assert.equal(failed.accepted,false);assert.equal(failed.stageCode,"SUBMIT");assert.equal(failed.replyCategory,"RECIPIENT_REJECTED");
 assert.match(failed.recipientAddress,/\*\*\*@example.org/);
});
