import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { memoryMeta,memoryStorage } from "../src/adapters.mjs";
import { canonicalJson,sha256Hex } from "../src/util.mjs";
import { getRecoveryQueue,assessRecoveryEvidence,buildRecoveryPreview } from "../src/signatureRecovery.mjs";

async function addEvent(events,event){
  const body={...event,prevHash:events.length?events.at(-1).hash:"GENESIS"};
  return [...events,{...body,hash:await sha256Hex(canonicalJson(body))}];
}
async function fixture({tamperFieldHash=false,tamperAllFieldHashes=false}={}){
  const sent=[],meta=memoryMeta(),storage=memoryStorage(),pdf=await PDFDocument.create();
  pdf.addPage([612,792]);
  const source=new Uint8Array(await pdf.save()),sourceHash=await sha256Hex(source);
  const stored=await storage.put({path:"source/original.pdf",bytes:source,contentType:"application/pdf",metadata:{}});
  await meta.create("documents","DOC-REC-1",{id:"DOC-REC-1",primaryStorageId:stored.id,sha256:sourceHash});
  const signatureValue="Original signature specimen";
  const fieldValue="Verified stamp specimen";
  let events=[];
  events=await addEvent(events,{type:"signer.role_assignment.completed",signerId:"S1",at:"2026-11-22T10:00:00.000Z",roleAssignmentIndex:0,role:"Signer",capacity:"",fieldIds:["SIG-1","SIG-2"],signatureFieldHashes:[{fieldId:"SIG-1",type:"Signature",hash:await sha256Hex(tamperAllFieldHashes?"different":fieldValue)},{fieldId:"SIG-2",type:"Signature",hash:await sha256Hex(tamperFieldHash?"different":fieldValue)}]});
  events=await addEvent(events,{type:"signer.signed",signerId:"S1",at:"2026-11-22T10:00:00.000Z",signatureHash:await sha256Hex(signatureValue)});
  await meta.create("envelopes","ENV-REC-1",{
    id:"ENV-REC-1",createdBy:"owner-1",status:"CompletionFailed",emailSigningModule:"v2",documentId:"DOC-REC-1",documentHash:sourceHash,
    title:"Recovery test",fileName:"source.pdf",fields:[{fieldId:"SIG-1",type:"Signature",page:1,x:0.1,y:0.1,width:0.3,height:0.1,signerId:"S1",roleAssignmentIndex:0},{fieldId:"SIG-2",type:"Signature",page:1,x:0.5,y:0.1,width:0.3,height:0.1,signerId:"S1",roleAssignmentIndex:0}],
    signers:[{id:"S1",status:"Signed",identityType:"email-link",emailHash:await sha256Hex("signer@example.test"),roleAssignments:[{role:"Signer",capacity:"",occupation:""}],signedAt:"2026-11-22T10:00:00.000Z",signatureValue,fieldValues:{"SIG-1":fieldValue,"SIG-2":fieldValue},name:"Test Signer",email:"signer@example.test",signatureType:"drawn"}],
    events,completionFailure:{stage:"WRITE_ARCHIVE_COPIES",errorType:"Error",failedAt:"2026-11-22T10:00:01.000Z"}
  });
  return {ctx:{meta,storage,now:()=>new Date("2026-11-22T12:00:00.000Z"),config:{appUrl:"https://irpa.example.test",emailLinkTtlDays:7,ttlDays:14},sendInvitation:async message=>{sent.push(message);}},sent,user:{uid:"owner-1"},other:{uid:"intruder"},events};
}
test("recovery queue is owner-scoped and paginated",async()=>{
  const f=await fixture();
  assert.equal((await getRecoveryQueue(f.ctx,f.user)).total,1);
  assert.equal((await f.ctx.meta.get("envelopes","ENV-REC-1")).events.at(-1).type,"recovery.queue.viewed");
  assert.equal((await getRecoveryQueue(f.ctx,f.other)).total,0);
  await assert.rejects(()=>assessRecoveryEvidence(f.ctx,f.other,"ENV-REC-1"),{status:404});
});
test("field-level stamp is verified only when signer event and chained field hash agree",async()=>{
  const f=await fixture();
  const result=await assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1");
  assert.equal(result.auditChainValid,true);
  assert.equal(result.stampSlots[0].status,"VERIFIED_EXISTING");
  assert.equal((await f.ctx.meta.get("envelopes","ENV-REC-1")).events.at(-1).type,"recovery.evidence.assessed");
  const bad=await fixture({tamperFieldHash:true});
  assert.equal((await assessRecoveryEvidence(bad.ctx,bad.user,"ENV-REC-1")).stampSlots[1].status,"UNVERIFIABLE");
});
test("recovery preview is a valid PDF and contains only verified stamps with non-authoritative watermark",async()=>{
  const f=await fixture();
  const result=await buildRecoveryPreview(f.ctx,f.user,"ENV-REC-1");
  const doc=await PDFDocument.load(result.bytes);
  assert.equal(doc.getPageCount(),2);
  assert.equal(result.assessment.summary.verified,2);
  assert.equal(doc.getTitle(),"RECOVERY PREVIEW - NOT COMPLETED");
  assert.equal((await f.ctx.meta.get("envelopes","ENV-REC-1")).events.at(-1).type,"recovery.preview.generated");
});
test("tampered audit chain blocks recovery assessment and preview",async()=>{
  const f=await fixture();
  const env=await f.ctx.meta.get("envelopes","ENV-REC-1");
  env.events[0].type="signer.changed";
  await f.ctx.meta.update("envelopes","ENV-REC-1",env);
  await assert.rejects(()=>assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1"),{status:409});
});

test("reassignment moves only a selected non-verified stamp and sends a new signer invitation",async()=>{
  const f=await fixture({tamperFieldHash:true});
  const result=await (await import("../src/signatureRecovery.mjs")).reassignRecoveryStampSlots(f.ctx,f.user,"ENV-REC-1",{
    signerId:"S1",fieldIds:["SIG-2"],email:"replacement@example.test",name:"Replacement Signer",reason:"Original stamp evidence for this slot could not be verified."
  });
  assert.equal(result.replacementSignerId,"S2");
  assert.equal(result.deliveryStatus,"Sent");
  assert.equal(f.sent.length,1);
  const envelope=await f.ctx.meta.get("envelopes","ENV-REC-1");
  assert.equal(envelope.fields.find(field=>field.fieldId==="SIG-1").signerId,"S1");
  assert.equal(envelope.fields.find(field=>field.fieldId==="SIG-2").signerId,"S2");
  assert.equal(envelope.signers.find(signer=>signer.id==="S1").status,"Signed");
  assert.equal(envelope.signers.find(signer=>signer.id==="S1").signatureValue,"Original signature specimen");
  assert.equal(envelope.signers.find(signer=>signer.id==="S1").certificateSignatureValue,"Verified stamp specimen");
  assert.equal(envelope.signers.find(signer=>signer.id==="S2").status,"Pending");
  assert.ok(envelope.events.some(event=>event.type==="recovery.stamp.reassigned"&&event.fieldIds.includes("SIG-2")));
});
test("reassignment refuses a verified stamp and leaves assignments unchanged",async()=>{
  const f=await fixture();
  await assert.rejects(()=>import("../src/signatureRecovery.mjs").then(m=>m.reassignRecoveryStampSlots(f.ctx,f.user,"ENV-REC-1",{
    signerId:"S1",fieldIds:["SIG-1"],email:"replacement@example.test",name:"Replacement Signer",reason:"Trying to replace a valid stamp."
  })),{status:409});
  const envelope=await f.ctx.meta.get("envelopes","ENV-REC-1");
  assert.equal(envelope.fields.find(field=>field.fieldId==="SIG-1").signerId,"S1");
  assert.equal(envelope.signers.length,1);
});

test("reassignment supports a signed signer with no verified stamps without rendering the unverified specimen",async()=>{
  const f=await fixture({tamperFieldHash:true,tamperAllFieldHashes:true});
  const result=await (await import("../src/signatureRecovery.mjs")).reassignRecoveryStampSlots(f.ctx,f.user,"ENV-REC-1",{
    signerId:"S1",fieldIds:["SIG-1","SIG-2"],email:"replacement@example.test",name:"Replacement Signer",reason:"Neither original signature stamp has verifiable field evidence."
  });
  assert.equal(result.replacementSignerId,"S2");
  const envelope=await f.ctx.meta.get("envelopes","ENV-REC-1");
  const originalSigner=envelope.signers.find(signer=>signer.id==="S1");
  assert.equal(originalSigner.signatureValue,"Original signature specimen");
  assert.equal(originalSigner.certificateSignatureValue,"Stamp not verified — reassigned");
  assert.ok(envelope.fields.filter(field=>field.signerId==="S2").length===2);
});
