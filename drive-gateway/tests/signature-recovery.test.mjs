import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { memoryMeta,memoryStorage } from "../src/adapters.mjs";
import { canonicalJson,sha256Hex } from "../src/util.mjs";
import { getRecoveryQueue,assessRecoveryEvidence,buildRecoveryPreview,reassignRecoveryStampSlots,createSignatureRecoveryRouter } from "../src/signatureRecovery.mjs";

async function addEvent(events,event){
  const body={...event,prevHash:events.length?events.at(-1).hash:"GENESIS"};
  return [...events,{...body,hash:await sha256Hex(canonicalJson(body))}];
}
async function fixture({tamperFieldHash=false,tamperAllFieldHashes=false,stampCount=2}={}){
  const sent=[],meta=memoryMeta(),storage=memoryStorage(),pdf=await PDFDocument.create();
  pdf.addPage([612,792]);
  const source=new Uint8Array(await pdf.save()),sourceHash=await sha256Hex(source);
  const stored=await storage.put({path:"source/original.pdf",bytes:source,contentType:"application/pdf",metadata:{}});
  await meta.create("documents","DOC-REC-1",{id:"DOC-REC-1",primaryStorageId:stored.id,sha256:sourceHash});
  const signatureValue="Original signature specimen";
  const fieldValue="Verified stamp specimen";
  const fieldIds=stampCount===12?Array.from({length:12},(_,index)=>"SIG-"+(index+1)) : ["SIG-1","SIG-2"];
  const fieldValues=Object.fromEntries(fieldIds.map(fieldId=>[fieldId,fieldValue]));
  let events=[];
  const signatureFieldHashes=await Promise.all(fieldIds.map(async fieldId=>({fieldId,type:"Signature",hash:await sha256Hex(tamperAllFieldHashes||(fieldId==="SIG-2"&&tamperFieldHash)?"different":fieldValue)})));
  events=await addEvent(events,{type:"signer.role_assignment.completed",signerId:"S1",at:"2026-11-22T10:00:00.000Z",roleAssignmentIndex:0,role:"Signer",capacity:"",fieldIds,signatureFieldHashes});
  events=await addEvent(events,{type:"signer.signed",signerId:"S1",at:"2026-11-22T10:00:00.000Z",signatureHash:await sha256Hex(signatureValue)});
  await meta.create("envelopes","ENV-REC-1",{
    id:"ENV-REC-1",dataEnvironment:"TEST",createdBy:"owner-1",status:"CompletionFailed",emailSigningModule:"v2",documentId:"DOC-REC-1",documentHash:sourceHash,
    title:"Recovery test",fileName:"source.pdf",classification:"Restricted",archiveTargets:[],fields:fieldIds.map((fieldId,index)=>({fieldId,type:"Signature",page:1,x:stampCount===12?0.05+(index%4)*0.23:(index===0?0.1:0.5),y:stampCount===12?0.08+Math.floor(index/4)*0.22:0.1,width:stampCount===12?0.18:0.3,height:stampCount===12?0.08:0.1,coordinateSpace:"visible-page-fraction-v1",signerId:"S1",roleAssignmentIndex:0})),
    signers:[{id:"S1",status:"Signed",identityType:"email-link",emailHash:await sha256Hex("signer@example.test"),roleAssignments:[{role:"Signer",capacity:"",occupation:""}],order:1,signedAt:"2026-11-22T10:00:00.000Z",signatureValue,fieldValues,name:"Test Signer",email:"signer@example.test",signatureType:"drawn"}],
    events,completionFailure:{stage:"WRITE_ARCHIVE_COPIES",errorType:"Error",failedAt:"2026-11-22T10:00:01.000Z"}
  });
  return {ctx:{meta,storage,env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test"},now:()=>new Date("2026-11-22T12:00:00.000Z"),config:{appUrl:"https://irpa.example.test",emailLinkTtlDays:7,ttlDays:14},sendInvitation:async message=>{sent.push(message);}},sent,user:{uid:"owner-1"},other:{uid:"intruder"},events};
}
test("recovery queue is owner-scoped and paginated",async()=>{
  const f=await fixture();
  assert.equal((await getRecoveryQueue(f.ctx,f.user)).total,1);
  assert.equal((await f.ctx.meta.get("envelopes","ENV-REC-1")).events.at(-1).type,"signer.signed");
  assert.equal((await f.ctx.meta.list("recoveryAccessEvents")).at(-1).type,"recovery.queue.viewed");
  assert.equal((await getRecoveryQueue(f.ctx,f.other)).total,0);
  await assert.rejects(()=>assessRecoveryEvidence(f.ctx,f.other,"ENV-REC-1"),{status:403});
});
test("owner queue includes all non-completed envelopes across owner field aliases",async()=>{
 const f=await fixture();const base=await f.ctx.meta.get("envelopes","ENV-REC-1");
 await f.ctx.meta.create("envelopes","ENV-CREATED-BY-UID",{...base,id:"ENV-CREATED-BY-UID",createdBy:undefined,createdByUid:"owner-1",status:"Sent"});
 await f.ctx.meta.create("envelopes","ENV-OWNER-UID",{...base,id:"ENV-OWNER-UID",createdBy:undefined,ownerUid:"owner-1",status:"Signing"});
 await f.ctx.meta.create("envelopes","ENV-COMPLETED",{...base,id:"ENV-COMPLETED",status:"Completed"});
 const queue=await getRecoveryQueue(f.ctx,f.user,{limit:50,offset:0});
 assert.equal(queue.total,3);
 assert.ok(queue.items.some(item=>item.envelopeId==="ENV-CREATED-BY-UID"));
 assert.ok(queue.items.some(item=>item.envelopeId==="ENV-OWNER-UID"));
 assert.equal(queue.items.some(item=>item.envelopeId==="ENV-COMPLETED"),false);
 assert.equal((await assessRecoveryEvidence(f.ctx,f.user,"ENV-OWNER-UID")).envelopeId,"ENV-OWNER-UID");
 await assert.rejects(()=>assessRecoveryEvidence(f.ctx,f.user,"ENV-COMPLETED"),{status:409});
});
test("administrator queue includes non-completed envelopes across owners",async()=>{
 const f=await fixture();const base=await f.ctx.meta.get("envelopes","ENV-REC-1");
 await f.ctx.meta.create("envelopes","ENV-OTHER-OWNER",{...base,id:"ENV-OTHER-OWNER",createdBy:"owner-2",status:"Sent"});
 assert.equal((await getRecoveryQueue(f.ctx,{uid:"admin-1",isAdmin:true})).total,2);
});
test("field-level stamp is verified only when signer event and chained field hash agree",async()=>{
  const f=await fixture();
  const result=await assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1");
  assert.equal(result.auditChainValid,true);
  assert.equal(result.stampSlots[0].status,"VERIFIED_EXISTING");
  assert.equal((await f.ctx.meta.get("envelopes","ENV-REC-1")).events.at(-1).type,"signer.signed");
  assert.equal((await f.ctx.meta.list("recoveryAccessEvents")).at(-1).type,"recovery.evidence.assessed");
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
  assert.equal((await f.ctx.meta.get("envelopes","ENV-REC-1")).events.at(-1).type,"signer.signed");
  assert.ok((await f.ctx.meta.list("recoveryAccessEvents")).some(event=>event.type==="recovery.preview.generated"));
});

test("queue, evidence assessment and preview leave envelope, signer, field and signing audit records unchanged",async()=>{
  const f=await fixture();
  const before=await f.ctx.meta.get("envelopes","ENV-REC-1");
  await getRecoveryQueue(f.ctx,f.user);
  await assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1");
  await buildRecoveryPreview(f.ctx,f.user,"ENV-REC-1");
  const after=await f.ctx.meta.get("envelopes","ENV-REC-1");
  assert.deepEqual(after,before);
  const accessEvents=await f.ctx.meta.list("recoveryAccessEvents");
  assert.deepEqual(accessEvents.map(event=>event.type).sort(),[
    "recovery.evidence.assessed","recovery.evidence.assessed","recovery.preview.generated","recovery.queue.viewed"
  ]);
});

test("tampered audit chain is reported as partial evidence while preview remains fail-closed",async()=>{
  const f=await fixture();
  const env=await f.ctx.meta.get("envelopes","ENV-REC-1");
  env.events[0].type="signer.changed";
  await f.ctx.meta.update("envelopes","ENV-REC-1",env);
  const result=await assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1");
  assert.equal(result.auditChain.status,"FAILED");
  await assert.rejects(()=>buildRecoveryPreview(f.ctx,f.user,"ENV-REC-1"),{status:409});
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

test("complete recovery lifecycle signs the replacement slot and finalizes only after the new signer signs",async()=>{
  const f=await fixture({tamperFieldHash:true});
  const reassigned=await reassignRecoveryStampSlots(f.ctx,f.user,"ENV-REC-1",{
    signerId:"S1",fieldIds:["SIG-2"],email:"replacement@example.test",name:"Replacement Signer",reason:"Original stamp evidence for this slot could not be verified."
  });
  assert.equal(reassigned.deliveryStatus,"Sent");
  const invitationUrl=new URL(f.sent[0].link);
  const token=invitationUrl.searchParams.get("emailSignToken");
  assert.ok(token);
  const {openEmailSigning,sign}=await import("../src/signing.mjs");
  const opened=await openEmailSigning(f.ctx,token,"192.0.2.44");
  const png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const completed=await sign(f.ctx,{
    token:opened.sessionToken,signature:{type:"field-applications"},
    fieldApplications:[{fieldId:"SIG-2",page:1,x:0.5,y:0.1,width:0.3,height:0.1,coordinateSpace:"visible-page-fraction-v1",confirmed:true,value:png}],
    signatureConfirmed:true,consent:true,declarations:{name:"Replacement Signer"}
  });
  assert.equal(completed.completed,true);
  assert.equal(completed.status,"Completed");
  const envelope=await f.ctx.meta.get("envelopes","ENV-REC-1");
  assert.equal(envelope.status,"Completed");
  assert.ok(envelope.completion?.finalHash);
  assert.equal(envelope.signers.find(signer=>signer.id==="S2").status,"Signed");
  assert.equal(envelope.fields.find(field=>field.fieldId==="SIG-2").signerId,"S2");
});

test("partial assessment accepts the source hash field written by the upload path",async()=>{
  const f=await fixture();
  const doc=await f.ctx.meta.get("documents","DOC-REC-1");
  await f.ctx.meta.update("documents","DOC-REC-1",{sha256:null,hash:doc.sha256});
  const result=await assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1");
  assert.equal(result.sourceHashStatus,"VERIFIED");
  assert.equal(result.auditChain.status,"VERIFIED");
  assert.equal(result.finalisationStage,"ARCHIVE");
});

test("missing audit events and missing source hash return independent partial evidence",async()=>{
  const f=await fixture();
  const envelope=await f.ctx.meta.get("envelopes","ENV-REC-1");
  await f.ctx.meta.update("envelopes","ENV-REC-1",{events:[],documentHash:null,originalHash:null});
  await f.ctx.meta.update("documents","DOC-REC-1",{sha256:null,hash:null});
  const result=await assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1");
  assert.equal(result.auditChain.status,"NO_EVENTS");
  assert.equal(result.sourceHashStatus,"NO_STORED_HASH");
  assert.equal(result.stampSlots.every(row=>row.status==="MISSING"),true);
  assert.equal((await f.ctx.meta.get("envelopes","ENV-REC-1")).events.length,0);
});

test("missing source bytes do not hide audit and stamp evidence",async()=>{
  const f=await fixture();
  const doc=await f.ctx.meta.get("documents","DOC-REC-1");
  await f.ctx.storage.delete(doc.primaryStorageId);
  const result=await assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1");
  assert.equal(result.auditChain.status,"VERIFIED");
  assert.equal(result.sourceHashStatus,"SOURCE_FILE_MISSING");
  assert.equal(result.stampSlots[0].status,"VERIFIED_EXISTING");
  await assert.rejects(()=>buildRecoveryPreview(f.ctx,f.user,"ENV-REC-1"),{status:409});
});

test("a missing stamp value is reported without failing the complete assessment",async()=>{
  const f=await fixture();
  const envelope=await f.ctx.meta.get("envelopes","ENV-REC-1");
  await f.ctx.meta.update("envelopes","ENV-REC-1",{signers:envelope.signers.map(s=>({...s,fieldValues:{"SIG-2":s.fieldValues["SIG-2"]}}))});
  const result=await assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1");
  assert.equal(result.stampSlots.find(row=>row.fieldId==="SIG-1").status,"UNVERIFIABLE");
  assert.equal(result.stampSlots.find(row=>row.fieldId==="SIG-2").status,"VERIFIED_EXISTING");
});

test("a failed audit chain is reported as partial evidence, not a global not-found error",async()=>{
  const f=await fixture();
  const envelope=await f.ctx.meta.get("envelopes","ENV-REC-1");
  const events=envelope.events.map((event,index)=>index===0?{...event,type:"tampered.event"}:event);
  await f.ctx.meta.update("envelopes","ENV-REC-1",{events});
  const result=await assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1");
  assert.equal(result.auditChain.status,"FAILED");
  assert.equal(result.stampSlots.every(row=>row.status==="UNVERIFIABLE"),true);
});
test("a mismatch against any stored source hash is reported without suppressing other evidence",async()=>{
  const f=await fixture();
  await f.ctx.meta.update("documents","DOC-REC-1",{hash:"0".repeat(64)});
  const result=await assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1");
  assert.equal(result.sourceHashStatus,"MISMATCH");
  assert.equal(result.auditChain.status,"VERIFIED");
  assert.equal(result.stampSlots[0].status,"VERIFIED_EXISTING");
});
test("owner queue still exposes an envelope when its signing audit chain is invalid",async()=>{
  const f=await fixture();
  const envelope=await f.ctx.meta.get("envelopes","ENV-REC-1");
  await f.ctx.meta.update("envelopes","ENV-REC-1",{events:envelope.events.map((event,index)=>index===0?{...event,type:"tampered.event"}:event)});
  const queue=await getRecoveryQueue(f.ctx,f.user);
  assert.equal(queue.total,1);
  const result=await assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1");
  assert.equal(result.auditChain.status,"FAILED");
  assert.equal(result.stampSlots.every(row=>row.status==="UNVERIFIABLE"),true);
});

test("read-only recovery evidence GET route is wired and rejects unauthenticated requests",async()=>{
  let authenticationAttempts=0;
  const router=createSignatureRecoveryRouter({
    authenticateFirebaseRequest:async()=>{authenticationAttempts++;throw new Error("missing bearer token");},
    getFirestoreDocument:async()=>null,
    buildContext:()=>{throw new Error("context must not be built for an unauthenticated request");},
    json:(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers}),
    corsHeaders:()=>({"content-type":"application/json"})
  });
  const request=new Request("https://worker.test/api/recovery/envelopes/test-id/evidence",{method:"GET"});
  const response=await router(request,{},"/api/recovery/envelopes/test-id/evidence");
  assert.equal(response.status,401);
  assert.match((await response.json()).error,/sign-in/i);
  assert.equal(authenticationAttempts,1);
});

test("recovery evidence router refuses non-GET methods before authentication or mutation",async()=>{
  let authenticationAttempts=0;
  const router=createSignatureRecoveryRouter({
    authenticateFirebaseRequest:async()=>{authenticationAttempts++;throw new Error("should not be called");},
    getFirestoreDocument:async()=>null,
    buildContext:()=>{throw new Error("should not be called");},
    json:(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers}),
    corsHeaders:()=>({"content-type":"application/json"})
  });
  const response=await router(new Request("https://worker.test/api/recovery/envelopes/test-id/evidence",{method:"POST"}),{},"/api/recovery/envelopes/test-id/evidence");
  assert.equal(response.status,405);
  assert.equal(authenticationAttempts,0);
});


test("completed-copy recovery route is authenticated and serves only the exact preserved hash-matched PDF",async()=>{
  const bytes=new TextEncoder().encode("%PDF-1.7\\nexisting archive-pending PDF\\n%%EOF");
  const hash=await sha256Hex(bytes);
  const envelope={id:"ENV-REC-COPY",createdBy:"owner-copy",status:"CompletionFailed",dataEnvironment:"TEST",completion:{finalHash:hash,archivePending:{storageId:"pending-copy",finalHash:hash,fileName:"preserved.pdf",createdAt:"2026-11-23T06:00:00.000Z",environment:"TEST"}}};
  let reads=0,writes=0,authCalls=0;
  const ctx={
    env:{IRPA_ENVIRONMENT:"test"},
    meta:{async get(collection,id){assert.equal(collection,"envelopes");assert.equal(id,envelope.id);return structuredClone(envelope);},async update(){writes++;throw Error("writes forbidden");},async create(){writes++;throw Error("writes forbidden");}},
    storage:{async get(id){reads++;assert.equal(id,"pending-copy");return new Uint8Array(bytes);},async put(){writes++;throw Error("writes forbidden");},async delete(){writes++;throw Error("writes forbidden");}},
    now:()=>new Date("2026-11-23T06:01:00.000Z")
  };
  const router=createSignatureRecoveryRouter({
    authenticateFirebaseRequest:async()=>{authCalls++;return {user_id:"owner-copy",token:"test-token"};},
    getFirestoreDocument:async()=>null,
    buildContext:()=>ctx,
    json:(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers}),
    corsHeaders:()=>({"access-control-allow-origin":"*"})
  });
  const response=await router(new Request("https://worker.test/api/recovery/envelopes/ENV-REC-COPY/completed-copy.pdf"),{}, "/api/recovery/envelopes/ENV-REC-COPY/completed-copy.pdf");
  assert.equal(response.status,200);
  assert.equal(response.headers.get("content-type"),"application/pdf");
  assert.equal(response.headers.get("x-irpa-copy-status"),"UNARCHIVED_NOT_COMPLETED");
  assert.equal(response.headers.get("x-irpa-document-sha256"),hash);
  assert.match(response.headers.get("x-irpa-copy-disclaimer"),/not yet Completed/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
  assert.equal(authCalls,1);
  assert.equal(reads,1);
  assert.equal(writes,0);
  assert.equal(envelope.status,"CompletionFailed");
});

test("completed-copy recovery route rejects unauthenticated callers before building context",async()=>{
  let contextBuilds=0;
  const router=createSignatureRecoveryRouter({
    authenticateFirebaseRequest:async()=>{throw Error("missing bearer token");},
    getFirestoreDocument:async()=>null,
    buildContext:()=>{contextBuilds++;throw Error("must not build context");},
    json:(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers}),
    corsHeaders:()=>({})
  });
  const response=await router(new Request("https://worker.test/api/recovery/envelopes/ENV-REC-COPY/completed-copy.pdf"),{}, "/api/recovery/envelopes/ENV-REC-COPY/completed-copy.pdf");
  assert.equal(response.status,401);
  assert.equal(contextBuilds,0);
});

test("completed-copy recovery route fails closed for non-owners and hash mismatches without writes",async()=>{
  const bytes=new TextEncoder().encode("%PDF-1.7\\npreserved bytes\\n%%EOF");
  const hash=await sha256Hex(bytes);
  const envelope={id:"ENV-REC-COPY",createdBy:"actual-owner",status:"CompletionFailed",dataEnvironment:"TEST",completion:{finalHash:hash,archivePending:{storageId:"pending-copy",finalHash:hash,createdAt:"2026-11-23T06:00:00.000Z",environment:"TEST"}}};
  let reads=0,writes=0,caller="intruder",corrupt=false;
  const ctx={env:{IRPA_ENVIRONMENT:"test"},meta:{async get(){return structuredClone(envelope);},async update(){writes++;throw Error("writes forbidden");},async create(){writes++;throw Error("writes forbidden");}},storage:{async get(){reads++;return corrupt?new TextEncoder().encode("wrong"):new Uint8Array(bytes);},async put(){writes++;throw Error("writes forbidden");},async delete(){writes++;throw Error("writes forbidden");}},now:()=>new Date("2026-11-23T06:01:00.000Z")};
  const router=createSignatureRecoveryRouter({authenticateFirebaseRequest:async()=>({user_id:caller,token:"test-token"}),getFirestoreDocument:async()=>null,buildContext:()=>ctx,json:(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers}),corsHeaders:()=>({})});
  const url="https://worker.test/api/recovery/envelopes/ENV-REC-COPY/completed-copy.pdf";
  const denied=await router(new Request(url),{},new URL(url).pathname);
  assert.equal(denied.status,403);
  assert.equal(reads,0);
  caller="actual-owner";corrupt=true;
  const mismatch=await router(new Request(url),{},new URL(url).pathname);
  assert.equal(mismatch.status,409);
  assert.equal(reads,1);
  assert.equal(writes,0);
});


test("evidence assessment exposes persisted finalisation stages and archive-pending metadata without mutating the envelope",async()=>{
  const f=await fixture();
  const before=await f.ctx.meta.get("envelopes","ENV-REC-1");
  const finalisationRecord={
    latestStage:"ARCHIVE",
    firstFailedStage:"ARCHIVE",
    updatedAt:"2026-11-22T10:00:02.000Z",
    stages:{
      PDF_BUILD:{status:"PASS",stageCode:"PDF_BUILD",errorCode:null,errorMessage:null,recordedAt:"2026-11-22T10:00:00.500Z"},
      HASH:{status:"PASS",stageCode:"HASH",errorCode:null,errorMessage:null,recordedAt:"2026-11-22T10:00:01.000Z"},
      ARCHIVE:{status:"FAILED",stageCode:"ARCHIVE",errorCode:"STORAGE_WRITE",errorMessage:"Archive write failed for owner@example.test; token Bearer secret-value https://private.example/path",recordedAt:"2026-11-22T10:00:02.000Z"}
    }
  };
  const completion={archivePending:{storageId:"private-storage-reference",path:"private/archive/pending.pdf",finalHash:"a".repeat(64),fileName:"family-session-signed.pdf",createdAt:"2026-11-22T10:00:03.000Z",environment:"TEST"}};
  await f.ctx.meta.update("envelopes","ENV-REC-1",{finalisationRecord,completion});
  const envelopeBeforeAssessment=await f.ctx.meta.get("envelopes","ENV-REC-1");
  const result=await assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1");
  assert.equal(result.finalisationStage,"ARCHIVE");
  assert.equal(result.finalisationStageCode,"WRITE_ARCHIVE_COPIES");
  assert.equal(result.finalisationRecord.latestStage,"ARCHIVE");
  assert.equal(result.finalisationRecord.firstFailedStage,"ARCHIVE");
  assert.equal(result.finalisationRecord.stages.length,3);
  assert.equal(result.finalisationRecord.stages[2].errorCode,"STORAGE_WRITE");
  assert.doesNotMatch(result.finalisationRecord.stages[2].errorMessage,/owner@example\.test|secret-value|private\.example/);
  assert.equal(result.stageRecordIntegrity.status,"CONSISTENT");
  assert.equal(result.stageRecordIntegrity.firstFailedStageMeaning,"FIRST_FAILED_ENTRY_IN_STORED_MAP_NOT_PROVEN_CHRONOLOGY");
  assert.equal(result.archivePending.metadataPresent,true);
  assert.equal(result.archivePending.storageReferencePresent,true);
  assert.equal(result.archivePending.recordedHashPresent,true);
  assert.equal(result.archivePending.recordedHash,"a".repeat(64));
  assert.equal(result.archivePending.fileName,"family-session-signed.pdf");
  assert.equal(result.archivePending.artifactBytesVerified,false);
  assert.equal(JSON.stringify(result).includes("private-storage-reference"),false);
  assert.equal(JSON.stringify(result).includes("private/archive/pending.pdf"),false);
  assert.deepEqual(await f.ctx.meta.get("envelopes","ENV-REC-1"),envelopeBeforeAssessment);
});

test("evidence assessment reports absent persisted finalisation and archive-pending metadata distinctly",async()=>{
  const f=await fixture();
  const result=await assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1");
  assert.equal(result.finalisationStage,"ARCHIVE");
  assert.equal(result.stageRecordIntegrity.status,"NOT_PRESENT");
  assert.equal(result.finalisationRecord.stages.length,0);
  assert.equal(result.archivePending.metadataPresent,false);
  assert.equal(result.archivePending.artifactBytesVerified,false);
});


test("evidence assessment reports sanitised environment agreement and verifies preserved archive bytes without envelope mutation",async()=>{
  const f=await fixture();
  const preserved=new TextEncoder().encode("%PDF-1.7\\npreserved signed artifact\\n%%EOF");
  const stored=await f.ctx.storage.put({path:"private/pending.pdf",bytes:preserved,contentType:"application/pdf",metadata:{}});
  const hash=await sha256Hex(preserved);
  await f.ctx.meta.update("envelopes","ENV-REC-1",{completion:{archivePending:{storageId:stored.id,finalHash:hash,environment:"TEST",fileName:"preserved.pdf"}}});
  const before=await f.ctx.meta.get("envelopes","ENV-REC-1");
  const result=await assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1");
  assert.deepEqual(result.environmentDiagnostics,{envelope:"TEST",preservedCopy:"TEST",gatewayExpected:"TEST",allMatch:true});
  assert.equal(result.archivePending.artifactBytesVerified,true);
  assert.equal(result.archivePending.artifactIntegrityStatus,"MATCH");
  assert.equal(JSON.stringify(result).includes(stored.id),false);
  assert.deepEqual(await f.ctx.meta.get("envelopes","ENV-REC-1"),before);
});

test("evidence assessment classifies legacy production environment without accepting it as canonical",async()=>{
  const f=await fixture();
  const envelope=await f.ctx.meta.get("envelopes","ENV-REC-1");
  await f.ctx.meta.update("envelopes","ENV-REC-1",{dataEnvironment:"PRODUCTION",completion:{archivePending:{storageId:"missing-pending",finalHash:"a".repeat(64),environment:"PRODUCTION"}}});
  const result=await assessRecoveryEvidence(f.ctx,f.user,"ENV-REC-1");
  assert.deepEqual(result.environmentDiagnostics,{envelope:"LEGACY_PRODUCTION",preservedCopy:"LEGACY_PRODUCTION",gatewayExpected:"TEST",allMatch:false});
  assert.equal(result.archivePending.artifactIntegrityStatus,"MISSING");
});


test("completed-copy route falls back to the same read-only emergency builder when preserved environment differs",async()=>{
  const f=await fixture({stampCount:12});
  const envelope=await f.ctx.meta.get("envelopes","ENV-REC-1");
  envelope.completion={archivePending:{storageId:"pending-from-other-env",finalHash:"a".repeat(64),environment:"ACTUAL"}};
  await f.ctx.meta.update("envelopes","ENV-REC-1",envelope);
  const before=await f.ctx.meta.get("envelopes","ENV-REC-1");
  const router=createSignatureRecoveryRouter({
    authenticateFirebaseRequest:async()=>({user_id:"owner-1",token:"test"}),
    getFirestoreDocument:async()=>null,buildContext:()=>f.ctx,
    json:(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers}),
    corsHeaders:()=>({})
  });
  const path="/api/recovery/envelopes/ENV-REC-1/completed-copy.pdf";
  const response=await router(new Request("https://gateway.test"+path),{},path);
  assert.equal(response.status,200);
  assert.equal(response.headers.get("x-irpa-copy-source"),"emergency-build");
  assert.equal(response.headers.get("x-irpa-copy-label"),"Unarchived copy; the envelope is not yet Completed");
  const bytes=new Uint8Array(await response.arrayBuffer());
  const hash=await sha256Hex(bytes);
  assert.equal(response.headers.get("x-irpa-output-sha256"),hash);
  assert.ok(bytes.length>0);
  assert.deepEqual(await f.ctx.meta.get("envelopes","ENV-REC-1"),before);
  assert.equal((await f.ctx.meta.list("recoveryAccessEvents")).length,0);
});

test("completed-copy route falls back to emergency build for missing and hash-mismatched preserved files",async()=>{
  for(const failure of ["missing","hash-mismatch"]){
    const f=await fixture({stampCount:12});
    const envelope=await f.ctx.meta.get("envelopes","ENV-REC-1");
    const source=await f.ctx.meta.get("documents","DOC-REC-1");
    const preservedId=failure==="missing"?"not-present":source.primaryStorageId;
    envelope.completion={archivePending:{storageId:preservedId,finalHash:"a".repeat(64),environment:"TEST"}};
    await f.ctx.meta.update("envelopes","ENV-REC-1",envelope);
    const before=await f.ctx.meta.get("envelopes","ENV-REC-1");
    const router=createSignatureRecoveryRouter({
      authenticateFirebaseRequest:async()=>({user_id:"owner-1",token:"test"}),
      getFirestoreDocument:async()=>null,buildContext:()=>f.ctx,
      json:(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers}),
      corsHeaders:()=>({})
    });
    const path="/api/recovery/envelopes/ENV-REC-1/completed-copy.pdf";
    const response=await router(new Request("https://gateway.test"+path),{},path);
    assert.equal(response.status,200,failure);
    assert.equal(response.headers.get("x-irpa-copy-source"),"emergency-build",failure);
    const bytes=new Uint8Array(await response.arrayBuffer());
    assert.equal(response.headers.get("x-irpa-output-sha256"),await sha256Hex(bytes),failure);
    assert.deepEqual(await f.ctx.meta.get("envelopes","ENV-REC-1"),before,failure);
    assert.equal((await f.ctx.meta.list("recoveryAccessEvents")).length,0,failure);
  }
});

test("emergency retrieval rejects a non-owner explicitly",async()=>{
  const f=await fixture();
  const router=createSignatureRecoveryRouter({
    authenticateFirebaseRequest:async()=>({user_id:"intruder",token:"test"}),
    getFirestoreDocument:async()=>null,buildContext:()=>f.ctx,
    json:(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers}),
    corsHeaders:()=>({})
  });
  const response=await router(new Request("https://gateway.test/api/recovery/envelopes/ENV-REC-1/emergency-retrieval",{method:"POST"}),{}, "/api/recovery/envelopes/ENV-REC-1/emergency-retrieval");
  assert.equal(response.status,403);
  const body=await response.json();
  assert.equal(body.error,"This envelope belongs to another owner.");
  assert.equal(body.code,"NOT_YOUR_ENVELOPE");
});

test("emergency retrieval returns stage log and SHA-256 without changing envelope or using a new timestamp",async()=>{
  const f=await fixture({stampCount:12});
  const before=await f.ctx.meta.get("envelopes","ENV-REC-1");
  f.ctx.now=()=>{throw new Error("CTX_NOW_MUST_NOT_BE_CALLED");};
  const router=createSignatureRecoveryRouter({
    authenticateFirebaseRequest:async()=>({user_id:"owner-1",token:"test"}),
    getFirestoreDocument:async()=>null,buildContext:()=>f.ctx,
    json:(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers}),
    corsHeaders:()=>({})
  });
  const response=await router(new Request("https://gateway.test/api/recovery/envelopes/ENV-REC-1/emergency-retrieval",{method:"POST"}),{}, "/api/recovery/envelopes/ENV-REC-1/emergency-retrieval");
  const responseBody=response.status===200?"":await response.clone().text();
  assert.equal(response.status,200,responseBody);
  assert.match(response.headers.get("x-irpa-output-sha256"),/^[a-f0-9]{64}$/);
  const stages=JSON.parse(response.headers.get("x-irpa-stage-log"));
  assert.ok(stages.some(stage=>stage.stageCode==="CERT_PAGE_VERIFY"&&stage.status==="pass"));
  assert.ok(stages.some(stage=>stage.stageCode==="STAMPS_IN_OUTPUT"&&stage.status==="not-checked"));
  assert.ok(stages.some(stage=>stage.stageCode==="DETACHED_EVIDENCE"&&stage.status==="not-checked"));
  assert.equal((await f.ctx.meta.get("envelopes","ENV-REC-1")).events.length,before.events.length);
  assert.deepEqual(await f.ctx.meta.get("envelopes","ENV-REC-1"),before);
});

test("corrupt stamp evidence fails closed and returns no PDF",async()=>{
  const f=await fixture({tamperFieldHash:true});
  const result=await (await import("../src/signatureRecovery.mjs")).buildEmergencyRetrieval(f.ctx,f.user,"ENV-REC-1");
  assert.equal(result.ok,false);
  assert.ok(result.stages.some(stage=>stage.stageCode==="STAMP_EVIDENCE"&&stage.status==="fail"));
  assert.equal(result.bytes,undefined);
});

test("repeat emergency retrieval has the same verification result",async()=>{
  const f=await fixture({stampCount:12});
  const module=await import("../src/signatureRecovery.mjs");
  const first=await module.buildEmergencyRetrieval(f.ctx,f.user,"ENV-REC-1");
  const second=await module.buildEmergencyRetrieval(f.ctx,f.user,"ENV-REC-1");
  assert.equal(first.ok,true);
  assert.equal(second.ok,true);
  assert.deepEqual(first.stages,second.stages);
  assert.equal(first.stages.find(stage=>stage.stageCode==="CERT_PAGE_VERIFY").status,"pass");
});
