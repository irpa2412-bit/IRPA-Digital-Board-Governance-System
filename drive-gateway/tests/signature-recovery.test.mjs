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
async function fixture({tamperFieldHash=false}={}){
  const meta=memoryMeta(),storage=memoryStorage(),pdf=await PDFDocument.create();
  pdf.addPage([612,792]);
  const source=new Uint8Array(await pdf.save()),sourceHash=await sha256Hex(source);
  const stored=await storage.put({path:"source/original.pdf",bytes:source,contentType:"application/pdf",metadata:{}});
  await meta.create("documents","DOC-REC-1",{id:"DOC-REC-1",primaryStorageId:stored.id,sha256:sourceHash});
  const signatureValue="Test Signer";
  const fieldValue="Test Signer";
  let events=[];
  events=await addEvent(events,{type:"signer.role_assignment.completed",signerId:"S1",at:"2026-11-22T10:00:00.000Z",roleAssignmentIndex:0,role:"Signer",capacity:"",fieldIds:["SIG-1"],signatureFieldHashes:[{fieldId:"SIG-1",type:"Signature",hash:await sha256Hex(tamperFieldHash?"different":fieldValue)}]});
  events=await addEvent(events,{type:"signer.signed",signerId:"S1",at:"2026-11-22T10:00:00.000Z",signatureHash:await sha256Hex(signatureValue)});
  await meta.create("envelopes","ENV-REC-1",{
    id:"ENV-REC-1",createdBy:"owner-1",status:"CompletionFailed",documentId:"DOC-REC-1",documentHash:sourceHash,
    title:"Recovery test",fileName:"source.pdf",fields:[{fieldId:"SIG-1",type:"Signature",page:1,x:0.1,y:0.1,width:0.3,height:0.1,signerId:"S1"}],
    signers:[{id:"S1",status:"Signed",signedAt:"2026-11-22T10:00:00.000Z",signatureValue,fieldValues:{"SIG-1":fieldValue},name:"Test Signer",email:"signer@example.test",signatureType:"drawn"}],
    events,completionFailure:{stage:"WRITE_ARCHIVE_COPIES",errorType:"Error",failedAt:"2026-11-22T10:00:01.000Z"}
  });
  return {ctx:{meta,storage},user:{uid:"owner-1"},other:{uid:"intruder"},events};
}
test("recovery queue is owner-scoped and paginated",async()=>{
  const f=await fixture();
  assert.equal((await getRecoveryQueue(f.ctx,f.user)).total,1);
  assert.equal((await getRecoveryQueue(f.ctx,f.other)).total,0);
  await assert.rejects(()=>assessRecoveryEvidence(f.ctx,f.other,"ENV-REC-1"),{status:404});
});
test("field-level stamp is verified only when signer event and chained field hash agree",async()=>{
  const f=await fixture();
  const result=await assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1");
  assert.equal(result.auditChainValid,true);
  assert.equal(result.stampSlots[0].status,"VERIFIED_EXISTING");
  const bad=await fixture({tamperFieldHash:true});
  assert.equal((await assessRecoveryEvidence(bad.ctx,bad.user,"ENV-REC-1")).stampSlots[0].status,"UNVERIFIABLE");
});
test("recovery preview is a valid PDF and contains only verified stamps with non-authoritative watermark",async()=>{
  const f=await fixture();
  const result=await buildRecoveryPreview(f.ctx,f.user,"ENV-REC-1");
  const doc=await PDFDocument.load(result.bytes);
  assert.equal(doc.getPageCount(),2);
  assert.equal(result.assessment.summary.verified,1);
  assert.ok(new TextDecoder().decode(result.bytes).includes("RECOVERY PREVIEW - NOT COMPLETED"));
});
test("tampered audit chain blocks recovery assessment and preview",async()=>{
  const f=await fixture();
  const env=await f.ctx.meta.get("envelopes","ENV-REC-1");
  env.events[0].type="signer.changed";
  await f.ctx.meta.update("envelopes","ENV-REC-1",env);
  await assert.rejects(()=>assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1"),{status:409});
});
