import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { PDFDocument } from "pdf-lib";
import { canonicalJson, sha256Hex } from "../src/util.mjs";

const png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
async function eventChain(events,event){
  const body={...event,prevHash:events.length?events.at(-1).hash:"GENESIS"};
  return [...events,{...body,hash:await sha256Hex(canonicalJson(body))}];
}
async function seededWorkerFixture(){
  const pdf=await PDFDocument.create();
  pdf.addPage([612,792]);pdf.addPage([612,792]);pdf.addPage([612,792]);
  const source=new Uint8Array(await pdf.save()),sourceHash=await sha256Hex(source);
  const fieldIds=Array.from({length:12},(_,i)=>"SIG-"+(i+1));
  const fieldValues=Object.fromEntries(fieldIds.map(id=>[id,png]));
  const signatureFieldHashes=await Promise.all(fieldIds.map(async fieldId=>({fieldId,type:"Signature",hash:await sha256Hex(png)})));
  let events=[];
  events=await eventChain(events,{type:"signer.role_assignment.completed",signerId:"S1",at:"2026-11-22T10:00:00.000Z",roleAssignmentIndex:0,role:"Signer",fieldIds,signatureFieldHashes});
  events=await eventChain(events,{type:"signer.signed",signerId:"S1",at:"2026-11-22T10:00:00.000Z",signatureHash:await sha256Hex(png)});
  const envelope={
    id:"ENV-WORKER-12-STAMPS",dataEnvironment:"TRIAL",createdBy:"owner-worker",status:"CompletionFailed",
    documentId:"DOC-WORKER-SOURCE",documentHash:sourceHash,title:"Worker runtime 12-stamp fixture",
    fields:fieldIds.map((fieldId,index)=>({fieldId,type:"Signature",page:index<6?1:3,x:0.05+(index%3)*0.3,y:0.08+Math.floor((index%6)/3)*0.28,width:0.2,height:0.12,coordinateSpace:"visible-page-fraction-v1",signerId:"S1",roleAssignmentIndex:0})),
    signers:[{id:"S1",status:"Signed",identityType:"email-link",name:"Worker Test Signer",email:"worker-signer@example.test",emailHash:await sha256Hex("worker-signer@example.test"),signedAt:"2026-11-22T10:00:00.000Z",signatureValue:png,signatureType:"drawn",fieldValues,roleAssignments:[{role:"Signer",capacity:""}]}],
    events,completionFailure:{stage:"WRITE_ARCHIVE_COPIES",failedAt:"2026-11-22T10:00:01.000Z"}
  };
  return {source,envelope,document:{id:"DOC-WORKER-SOURCE",primaryStorageId:"source-pdf",sha256:sourceHash},ownerUid:"owner-worker"};
}
test("12-stamp recovery runs in workerd with stamps on source pages 1 and 3 and returns byte-matching SHA-256",async()=>{
  const fixture=await seededWorkerFixture();
  const scriptPath=new URL("./workers/emergency-retrieval-worker.mjs",import.meta.url).pathname;
  const miniflare=new Miniflare({scriptPath,modules:true,compatibilityDate:"2026-09-29",compatibilityFlags:["nodejs_compat"],log:{level:"error"}});
  try{
    const sourceBase64=Buffer.from(fixture.source).toString("base64");
    const response=await miniflare.dispatchFetch("https://worker.test/recovery",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...fixture,sourceBase64})});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.ok,true,JSON.stringify({code:result.code,step:result.step,errorClass:result.errorClass,stages:result.stages}));
    assert.ok(result.stages.some(stage=>stage.stageCode==="AUDIT_CHAIN"&&stage.status==="PASS"));
    assert.ok(result.stages.some(stage=>stage.stageCode==="STAMP_LOAD"&&stage.status==="PASS"));
    assert.ok(result.stages.some(stage=>stage.stageCode==="STAMP_RENDER"&&stage.status==="PASS"));
    assert.ok(result.stages.some(stage=>stage.stageCode==="PDF_BUILD"&&stage.status==="PASS"));
    assert.ok(result.stages.some(stage=>stage.stageCode==="OUTPUT_SHA256"&&stage.status==="PASS"));
    const output=Uint8Array.from(Buffer.from(result.outputBase64,"base64"));
    assert.equal(await sha256Hex(output),result.outputHash);
    assert.ok(output.length>fixture.source.length);
    if(result.certificateWarning){
      assert.ok(["TEXT_EXTRACT","CERT_VERIFY"].includes(result.certificateWarning.step));
      assert.match(result.label,/Certificate page not verified/);
      assert.equal(result.checks.certificatePage,"NOT APPLICABLE");
    }else{
      assert.ok(result.stages.some(stage=>stage.stageCode==="CERT_VERIFY"&&stage.status==="PASS"));
    }
  }finally{await miniflare.dispose();}
});
