import test from "node:test";
import assert from "node:assert/strict";
import { distributeCompletedSignatureDocument, distributeCompletedPersonalCopies, retryFailedSignatureDistributions } from "../src/signatureDistribution.mjs";
import { sha256Hex } from "../src/util.mjs";

function context(bytes, failingEmail, failPersonalCopy=false) {
  const records=new Map();
  const sent=[];
  const attempts=new Map();
  const key=(collection,id)=>collection+"/"+id;
  const meta={
    async get(collection,id){return records.get(key(collection,id))||null;},
    async create(collection,id,value){
      const k=key(collection,id);
      if(records.has(k))throw new Error("record already exists");
      records.set(k,{...value,_v:1});
    },
    async update(collection,id,patch){
      const k=key(collection,id),current=records.get(k);
      if(!current)throw new Error("record not found");
      records.set(k,{...current,...patch,_v:Number(current._v||0)+1});
    },
    async list(collection){
      return [...records.entries()].filter(([k])=>k.startsWith(collection+"/")).map(([,value])=>value);
    }
  };
  return {
    sent,meta,failPersonalCopy,
    now:()=>new Date("2026-11-18T20:00:00.000Z"),
    storage:{get:async id=>id==="signed-pdf"?bytes:null,async put({path,bytes}){if(failPersonalCopy&&path.startsWith("My Documents/"))throw new Error("R2 personal-copy write denied");return{id:path,link:"r2://"+path};}},
    logger:{error(){}},
    async sendCompletionEmail(message){
      sent.push(message);
      const count=(attempts.get(message.to)||0)+1;
      attempts.set(message.to,count);
      if(message.to===failingEmail&&count===1)throw new Error("SMTP temporarily unavailable");
      return {messageId:"mail-"+count};
    }
  };
}

test("completion distribution emails the integrity-verified PDF to owner and every signed participant",async()=>{
  const bytes=new TextEncoder().encode("%PDF-1.7\ncompleted IRPA document");
  const ctx=context(bytes,"second@example.test");
  const envelope={
    id:"ENV-DISTRIBUTION-1",createdBy:"owner-uid",ownerEmail:"owner@example.test",ownerName:"Document Owner",
    status:"Completed",title:"Board Resolution",documentId:"DOC-1",
    signers:[
      {id:"S1",email:"first@example.test",name:"First Signer",uid:"first-uid",status:"Signed"},
      {id:"S2",email:"second@example.test",name:"Second Signer",uid:null,status:"Signed",identityType:"email-link"}
    ]
  };
  const completion={primaryStorageId:"signed-pdf",finalHash:await sha256Hex(bytes),fileName:"board-resolution-signed.pdf",completedAt:"2026-11-18T20:00:00.000Z"};
  const result=await distributeCompletedSignatureDocument(ctx,envelope,completion);
  assert.equal(result.total,3);
  assert.equal(result.sent,2);
  assert.equal(result.failed,1);
  assert.deepEqual(new Set(ctx.sent.map(item=>item.to)),new Set(["owner@example.test","first@example.test","second@example.test"]));
  for(const item of ctx.sent)assert.deepEqual(item.bytes,bytes);
});

test("failed completed-document email is retryable without resending already delivered copies",async()=>{
  const bytes=new TextEncoder().encode("%PDF-1.7\ncompleted IRPA document");
  const ctx=context(bytes,"second@example.test");
  const envelope={
    id:"ENV-DISTRIBUTION-2",createdBy:"owner-uid",ownerEmail:"owner@example.test",ownerName:"Document Owner",
    status:"Completed",title:"Board Resolution",documentId:"DOC-2",
    signers:[
      {id:"S1",email:"first@example.test",name:"First Signer",uid:"first-uid",status:"Signed"},
      {id:"S2",email:"second@example.test",name:"Second Signer",uid:null,status:"Signed",identityType:"email-link"}
    ]
  };
  const completion={primaryStorageId:"signed-pdf",finalHash:await sha256Hex(bytes),fileName:"board-resolution-signed.pdf",completedAt:"2026-11-18T20:00:00.000Z"};
  envelope.completion=completion;
  await ctx.meta.create("envelopes",envelope.id,envelope);
  const initial=await distributeCompletedSignatureDocument(ctx,envelope,completion);
  assert.equal(initial.failed,1);
  const retried=await retryFailedSignatureDistributions(ctx,{uid:"owner-uid",isAdmin:false},envelope.id);
  assert.equal(retried.distribution.total,3);
  assert.equal(retried.distribution.sent,3);
  assert.equal(retried.distribution.failed,0);
  assert.equal(ctx.sent.filter(item=>item.to==="owner@example.test").length,1);
  assert.equal(ctx.sent.filter(item=>item.to==="first@example.test").length,1);
  assert.equal(ctx.sent.filter(item=>item.to==="second@example.test").length,2);
});

test("personal-copy storage failures never block completed-document email delivery",async()=>{
  const bytes=new TextEncoder().encode("%PDF-1.7\\ncompleted IRPA document");
  const ctx=context(bytes,null,true);
  const envelope={
    id:"ENV-PERSONAL-COPY-FAIL",createdBy:"owner-uid",ownerEmail:"owner@example.test",ownerName:"Document Owner",
    status:"Completed",title:"Board Resolution",documentId:"DOC-PERSONAL-COPY",
    signers:[
      {id:"S1",email:"first@example.test",name:"First Signer",uid:"first-uid",status:"Signed"},
      {id:"S2",email:"second@example.test",name:"Second Signer",uid:null,profileUid:null,status:"Signed",identityType:"email-link"}
    ]
  };
  const completion={primaryStorageId:"signed-pdf",finalHash:await sha256Hex(bytes),fileName:"board-resolution-signed.pdf",completedAt:"2026-11-18T20:00:00.000Z"};
  const emailResult=await distributeCompletedSignatureDocument(ctx,envelope,completion);
  assert.equal(emailResult.sent,3);
  const copyResult=await distributeCompletedPersonalCopies(ctx,envelope,completion);
  assert.equal(copyResult.total,2);
  assert.equal(copyResult.failed,2);
  assert.equal(copyResult.skipped,1);
  assert.equal(ctx.sent.length,3);
  assert.equal((await ctx.meta.list("signaturePersonalCopies")).length,2);
});
