import test from "node:test";
import assert from "node:assert/strict";
import { distributeCompletedSignatureDocument, distributeCompletedPersonalCopies, retryFailedSignatureDistributions, getSignatureDistributionSummary } from "../src/signatureDistribution.mjs";
import { sha256Hex } from "../src/util.mjs";

function context(bytes, failingEmail, failPersonalCopy=false, failuresBeforeSuccess=1) {
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
      const messageId="mail-"+count;
      await message.onStage?.("BUILD_MESSAGE","success","UNKNOWN",{messageId});
      if(message.to===failingEmail&&count<=failuresBeforeSuccess){
        await message.onStage?.("SMTP_CONNECT","failure","CONNECTION_REFUSED",{messageId});
        const error=new Error("SMTP temporarily unavailable");error.stageCode="SMTP_CONNECT";error.smtpReplyCategory="CONNECTION_REFUSED";throw error;
      }
      for(const stage of ["SMTP_CONNECT","SMTP_AUTH","RCPT_ACCEPTED","SUBMIT"])
        await message.onStage?.(stage,"success",stage==="SUBMIT"?"ACCEPTED":"UNKNOWN",{messageId});
      return {messageId};
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
  assert.equal(result.sent,3);
  assert.equal(result.failed,0);
  assert.deepEqual(new Set(ctx.sent.map(item=>item.to)),new Set(["owner@example.test","first@example.test","second@example.test"]));
  assert.equal(ctx.sent.filter(item=>item.to==="second@example.test").length,2,"one transient connection failure is retried automatically");
  const secondRecord=(await ctx.meta.list("signatureDistributions")).find(row=>row.recipientEmail==="second@example.test");
  assert.equal(secondRecord.attempts,2);
  assert.ok(secondRecord.stageHistory.some(item=>item.stage==="SMTP_CONNECT"&&item.outcome==="failure"));
  assert.ok(secondRecord.stageHistory.some(item=>item.stage==="SUBMIT"&&item.outcome==="success"));
  for(const item of ctx.sent)assert.deepEqual(item.bytes,bytes);
});

test("failed completed-document email is retryable without resending already delivered copies",async()=>{
  const bytes=new TextEncoder().encode("%PDF-1.7\ncompleted IRPA document");
  const ctx=context(bytes,"second@example.test",false,3);
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
  assert.equal(ctx.sent.filter(item=>item.to==="second@example.test").length,3,"automatic attempts stop at three");
  const retried=await retryFailedSignatureDistributions(ctx,{uid:"owner-uid",isAdmin:false},envelope.id);
  assert.equal(retried.distribution.total,3);
  assert.equal(retried.distribution.sent,3);
  assert.equal(retried.distribution.failed,0);
  assert.equal(ctx.sent.filter(item=>item.to==="owner@example.test").length,1);
  assert.equal(ctx.sent.filter(item=>item.to==="first@example.test").length,1);
  assert.equal(ctx.sent.filter(item=>item.to==="second@example.test").length,4);
});

test("personal-copy storage failures never block completed-document email delivery",async()=>{
  const bytes=new TextEncoder().encode("%PDF-1.7\\ncompleted IRPA document");
  const ctx=context(bytes,null,true);
  const envelope={
    id:"ENV-PERSONAL-COPY-FAIL",createdBy:"owner-uid",ownerEmail:"owner@example.test",ownerName:"Document Owner",
    status:"Completed",title:"Board Resolution",documentId:"DOC-PERSONAL-COPY",
    signers:[
      {id:"S1",email:"first@example.test",name:"First Signer",uid:"first-uid",status:"Signed"},
      {id:"S2",email:"second@example.test",name:"Second Signer",uid:null,profileUid:null,status:"Signed",identityType:"email-link"},
      {id:"S3",email:"pending-profile@example.test",name:"Pending Profile Signer",uid:"pending-profile-uid",status:"Pending"}
    ]
  };
  const completion={primaryStorageId:"signed-pdf",finalHash:await sha256Hex(bytes),fileName:"board-resolution-signed.pdf",completedAt:"2026-11-18T20:00:00.000Z"};
  const emailResult=await distributeCompletedSignatureDocument(ctx,envelope,completion);
  assert.equal(emailResult.sent,4);
  const copyResult=await distributeCompletedPersonalCopies(ctx,envelope,completion);
  assert.equal(copyResult.total,3);
  assert.equal(copyResult.failed,3);
  assert.equal(copyResult.skipped,1);
  assert.equal(ctx.sent.length,4);
  assert.equal((await ctx.meta.list("signaturePersonalCopies")).length,3);
});

test("each signer position receives an independent delivery even when email addresses are duplicated",async()=>{
  const bytes=new TextEncoder().encode("%PDF-1.7\\ncompleted IRPA document");
  const ctx=context(bytes,null);
  const envelope={id:"ENV-DUPLICATE-EMAIL",createdBy:"owner-uid",ownerEmail:"owner@example.test",ownerName:"Owner",status:"Completed",title:"Board Resolution",documentId:"DOC-DUP",signers:[
    {id:"S1",email:"shared@example.test",name:"Signer One",uid:null,status:"Signed",identityType:"email-link"},
    {id:"S2",email:"shared@example.test",name:"Signer Two",uid:null,status:"Pending",identityType:"email-link"},
    {id:"S3",email:"shared@example.test",name:"Revoked Signer",uid:null,status:"Pending",identityType:"email-link",invitation:"Revoked",emailLinkStatus:"revoked"}
  ]};
  const completion={primaryStorageId:"signed-pdf",finalHash:await sha256Hex(bytes),fileName:"board-resolution-signed.pdf",completedAt:"2026-11-18T20:00:00.000Z"};
  const result=await distributeCompletedSignatureDocument(ctx,envelope,completion);
  assert.equal(result.total,3);
  assert.equal(result.sent,3);
  assert.equal(ctx.sent.filter(item=>item.to==="shared@example.test").length,2);
  const rows=await ctx.meta.list("signatureDistributions");
  assert.equal(new Set(rows.filter(row=>row.recipientEmail==="shared@example.test").map(row=>row.recipientKey)).size,2);
  assert.deepEqual(result.deliveries.filter(row=>row.recipientAddress==="s***@example.test").map(row=>row.signerIds[0]),["S1","S2"]);
});

test("legacy email-keyed Sent delivery is claimed once and not resent for the first signer position",async()=>{
  const bytes=new TextEncoder().encode("%PDF-1.7\\ncompleted IRPA document");
  const ctx=context(bytes,null);
  const envelope={id:"ENV-LEGACY-DISTRIBUTION",createdBy:"owner-uid",ownerEmail:"owner@example.test",ownerName:"Owner",status:"Completed",title:"Resolution",documentId:"DOC-LEGACY",signers:[
    {id:"S1",email:"shared@example.test",name:"Signer One",uid:null,status:"Signed",identityType:"email-link"},
    {id:"S2",email:"shared@example.test",name:"Signer Two",uid:null,status:"Signed",identityType:"email-link"}
  ]};
  const legacyId="delivery-"+envelope.id+"-"+(await sha256Hex("shared@example.test")).slice(0,32);
  await ctx.meta.create("signatureDistributions",legacyId,{envelopeId:envelope.id,recipientEmail:"shared@example.test",recipientEmailHash:await sha256Hex("shared@example.test"),recipientRoles:["Signer"],signerIds:["S1","S2"],status:"Sent",attempts:1,acceptedByMailServer:true,replyCategory:"ACCEPTED"});
  const completion={primaryStorageId:"signed-pdf",finalHash:await sha256Hex(bytes),fileName:"resolution-signed.pdf",completedAt:"2026-11-18T20:00:00.000Z"};
  const result=await distributeCompletedSignatureDocument(ctx,envelope,completion);
  assert.equal(result.total,3);
  assert.equal(result.sent,3);
  assert.equal(ctx.sent.filter(item=>item.to==="shared@example.test").length,1,"only the second signer position receives a new message");
  const rows=await ctx.meta.list("signatureDistributions");
  const shared=rows.filter(row=>row.recipientEmail==="shared@example.test");
  assert.equal(shared.length,2);
  assert.deepEqual(new Set(shared.map(row=>row.recipientKey)),new Set(["signer:S1","signer:S2"]));
});

test("repeat distribution reuses a claimed legacy recipient record without duplicate delivery",async()=>{
  const bytes=new TextEncoder().encode("%PDF-1.7\\ncompleted IRPA document");
  const ctx=context(bytes,null);
  const envelope={id:"ENV-LEGACY-IDEMPOTENT",createdBy:"owner-uid",ownerEmail:"owner@example.test",ownerName:"Owner",status:"Completed",title:"Resolution",documentId:"DOC-LEGACY-IDEMPOTENT",signers:[
    {id:"S1",email:"shared@example.test",name:"Signer One",uid:null,status:"Signed",identityType:"email-link"}
  ]};
  const completion={primaryStorageId:"signed-pdf",finalHash:await sha256Hex(bytes),fileName:"resolution-signed.pdf",completedAt:"2026-11-18T20:00:00.000Z"};
  await distributeCompletedSignatureDocument(ctx,envelope,completion);
  const firstSendCount=ctx.sent.length;
  const second=await distributeCompletedSignatureDocument(ctx,envelope,completion,{retryFailed:true});
  assert.equal(second.sent,2);
  assert.equal(ctx.sent.length,firstSendCount,"previously accepted owner and signer emails are not resent");
});

test("ambiguous SMTP SUBMIT outcome is recorded Unknown and is never automatically retried",async()=>{
  const bytes=new TextEncoder().encode("%PDF-1.7\\ncompleted IRPA document");
  const ctx=context(bytes,null);
  ctx.sendCompletionEmail=async message=>{
    ctx.sent.push(message);
    await message.onStage?.("BUILD_MESSAGE","success","UNKNOWN",{messageId:"ambiguous-message"});
    await message.onStage?.("SMTP_CONNECT","success","UNKNOWN",{messageId:"ambiguous-message"});
    await message.onStage?.("SMTP_AUTH","success","UNKNOWN",{messageId:"ambiguous-message"});
    await message.onStage?.("RCPT_ACCEPTED","success","UNKNOWN",{messageId:"ambiguous-message"});
    await message.onStage?.("SUBMIT","failure","UNKNOWN",{messageId:"ambiguous-message"});
    const error=new Error("SMTP connection closed after DATA");
    error.stageCode="SUBMIT";
    error.smtpReplyCategory="UNKNOWN";
    throw error;
  };
  const envelope={id:"ENV-UNKNOWN-SUBMIT",createdBy:"owner-uid",ownerEmail:"owner@example.test",ownerName:"Owner",status:"Completed",title:"Resolution",documentId:"DOC-UNKNOWN",signers:[]};
  const completion={primaryStorageId:"signed-pdf",finalHash:await sha256Hex(bytes),fileName:"resolution-signed.pdf",completedAt:"2026-11-18T20:00:00.000Z"};
  const result=await distributeCompletedSignatureDocument(ctx,envelope,completion);
  assert.equal(result.unknown,1);
  assert.equal(ctx.sent.length,1);
  const row=(await ctx.meta.list("signatureDistributions"))[0];
  assert.equal(row.status,"Unknown");
  assert.equal(row.deliveryOutcome,"unknown");
  assert.equal(row.attempts,1);
  await distributeCompletedSignatureDocument(ctx,envelope,completion,{retryFailed:true});
  assert.equal(ctx.sent.length,1,"ambiguous submission is not resent by a later retry pass");
});

test("email and My Documents retry trails continue independently when either summary fails",async()=>{
  const bytes=new TextEncoder().encode("%PDF-1.7\\ncompleted IRPA document");
  const envelopeFor=id=>({
    id,createdBy:"owner-uid",ownerEmail:"owner@example.test",ownerName:"Document Owner",
    status:"Completed",title:"Board Resolution",documentId:id,
    signers:[{id:"S1",email:"signer@example.test",name:"Signer",uid:"signer-uid",status:"Signed"}],
    completion:{primaryStorageId:"signed-pdf",finalHash:null,fileName:"board-resolution-signed.pdf",completedAt:"2026-11-18T20:00:00.000Z"}
  });
  const first=context(bytes,null);
  const firstEnvelope=envelopeFor("ENV-EMAIL-SUMMARY-FAIL");
  firstEnvelope.completion.finalHash=await sha256Hex(bytes);
  await first.meta.create("envelopes",firstEnvelope.id,firstEnvelope);
  const firstList=first.meta.list.bind(first.meta);
  first.meta.list=async collection=>{if(collection==="signatureDistributions")throw new Error("email summary store unavailable");return firstList(collection);};
  const firstResult=await retryFailedSignatureDistributions(first,{uid:"owner-uid"},firstEnvelope.id);
  assert.equal(firstResult.distribution.status,"Error");
  assert.equal(firstResult.personalCopies.stored,2,"owner and signer My Documents copies still complete");

  const second=context(bytes,null);
  const secondEnvelope=envelopeFor("ENV-PERSONAL-SUMMARY-FAIL");
  secondEnvelope.completion.finalHash=await sha256Hex(bytes);
  await second.meta.create("envelopes",secondEnvelope.id,secondEnvelope);
  const secondList=second.meta.list.bind(second.meta);
  second.meta.list=async collection=>{if(collection==="signaturePersonalCopies")throw new Error("My Documents index unavailable");return secondList(collection);};
  const secondResult=await retryFailedSignatureDistributions(second,{uid:"owner-uid"},secondEnvelope.id);
  assert.equal(secondResult.distribution.sent,2,"owner and signer email deliveries complete");
  assert.equal(secondResult.personalCopies.status,"Error");
});

test("summary counts every expected recipient even when an earlier failure leaves later records uncreated",async()=>{
  const ctx=context(new TextEncoder().encode("%PDF-1.7\\nsummary fixture"),null);
  const envelope={id:"ENV-PARTIAL-RECORDS",createdBy:"owner-uid",ownerEmail:"owner@example.test",ownerName:"Owner",status:"Completed",title:"Resolution",documentId:"DOC-PARTIAL",signers:[
    {id:"S1",email:"first@example.test",name:"First",uid:null,status:"Signed",identityType:"email-link"},
    {id:"S2",email:"second@example.test",name:"Second",uid:null,status:"Pending",identityType:"email-link"}
  ]};
  await ctx.meta.create("signatureDistributions","owner-delivery",{envelopeId:envelope.id,recipientKey:"owner:owner-uid",recipientEmail:"owner@example.test",status:"Sent",acceptedByMailServer:true,attempts:1});
  const summary=await getSignatureDistributionSummary(ctx,envelope.id,envelope);
  assert.equal(summary.total,3,"owner and both signer positions are expected recipients");
  assert.equal(summary.sent,1);
  assert.equal(summary.pending,2,"missing distribution rows must remain pending");
  assert.equal(summary.complete,false,"partial record persistence must never look complete");
  assert.equal(summary.status,"PartiallyDelivered");
  assert.deepEqual(summary.deliveries.map(row=>row.status),["Sent","Not Attempted","Not Attempted"]);
});

test("summary preserves an ambiguous SMTP result as Unknown rather than NotStarted",async()=>{
  const ctx=context(new TextEncoder().encode("%PDF-1.7\\nsummary fixture"),null);
  const envelope={id:"ENV-UNKNOWN-SUMMARY",createdBy:"owner-uid",ownerEmail:"owner@example.test",ownerName:"Owner",status:"Completed",title:"Resolution",documentId:"DOC-UNKNOWN-SUMMARY",signers:[]};
  await ctx.meta.create("signatureDistributions","owner-unknown",{envelopeId:envelope.id,recipientKey:"owner:owner-uid",recipientEmail:"owner@example.test",status:"Unknown",deliveryOutcome:"unknown",acceptedByMailServer:false,attempts:1});
  const summary=await getSignatureDistributionSummary(ctx,envelope.id,envelope);
  assert.equal(summary.total,1);
  assert.equal(summary.unknown,1);
  assert.equal(summary.complete,false);
  assert.equal(summary.status,"Unknown");
});
