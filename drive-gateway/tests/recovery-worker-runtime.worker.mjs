import { PDFDocument } from "pdf-lib";
import { memoryMeta,memoryStorage } from "../src/adapters.mjs";
import { canonicalJson,sha256Hex } from "../src/util.mjs";
import { buildEmergencyRetrieval } from "../src/signatureRecovery.mjs";

async function addEvent(events,event){
  const body={...event,prevHash:events.length?events.at(-1).hash:"GENESIS"};
  return [...events,{...body,hash:await sha256Hex(canonicalJson(body))}];
}
async function seededContext(){
  const pdf=await PDFDocument.create();
  pdf.addPage([612,792]);pdf.addPage([612,792]);pdf.addPage([612,792]);
  const source=new Uint8Array(await pdf.save()),sourceHash=await sha256Hex(source);
  const meta=memoryMeta(),storage=memoryStorage();
  const stored=await storage.put({path:"source/original.pdf",bytes:source,contentType:"application/pdf",metadata:{}});
  await meta.create("documents","DOC-WORKER",{id:"DOC-WORKER",primaryStorageId:stored.id,sha256:sourceHash});
  const fieldIds=Array.from({length:12},(_,i)=>"SIG-"+(i+1));
  const stampPng="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
  const fieldValues=Object.fromEntries(fieldIds.map(id=>[id,stampPng]));
  const signatureValue=stampPng;
  const signatureFieldHashes=await Promise.all(fieldIds.map(async fieldId=>({fieldId,type:"Signature",hash:await sha256Hex(fieldValues[fieldId])})));
  let events=[];
  events=await addEvent(events,{type:"signer.role_assignment.completed",signerId:"S1",at:"2026-11-23T06:00:00.000Z",roleAssignmentIndex:0,role:"Signer",capacity:"",fieldIds,signatureFieldHashes});
  events=await addEvent(events,{type:"signer.signed",signerId:"S1",at:"2026-11-23T06:00:00.000Z",signatureHash:await sha256Hex(signatureValue)});
  await meta.create("envelopes","ENV-WORKER",{
    id:"ENV-WORKER",dataEnvironment:"TEST",createdBy:"owner-1",status:"CompletionFailed",emailSigningModule:"v2",documentId:"DOC-WORKER",documentHash:sourceHash,
    title:"Worker recovery fixture",fields:fieldIds.map((fieldId,index)=>({fieldId,type:"Signature",page:index<6?1:3,x:0.05+(index%3)*0.3,y:0.08+Math.floor(index%6/3)*0.3,width:0.22,height:0.12,coordinateSpace:"visible-page-fraction-v1",signerId:"S1",roleAssignmentIndex:0})),
    signers:[{id:"S1",status:"Signed",identityType:"email-link",emailHash:await sha256Hex("signer@example.test"),roleAssignments:[{role:"Signer",capacity:"",occupation:""}],order:1,signedAt:"2026-11-23T06:00:00.000Z",signatureValue,fieldValues,name:"Worker Test Signer",email:"worker-signer@example.test",signatureType:"drawn"}],
    events,completionFailure:{stage:"WRITE_ARCHIVE_COPIES",errorType:"Error",failedAt:"2026-11-23T06:00:01.000Z"}
  });
  return {ctx:{meta,storage,env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test"},config:{appUrl:"https://irpa.example.test"}},user:{uid:"owner-1"}};
}
export default {
  async fetch(){
    try{
      const fixture=await seededContext();
      const before=await fixture.ctx.meta.get("envelopes","ENV-WORKER");
      const result=await buildEmergencyRetrieval(fixture.ctx,fixture.user,"ENV-WORKER");
      const after=await fixture.ctx.meta.get("envelopes","ENV-WORKER");
      return Response.json({ok:result.ok,certificateVerified:result.certificateVerified,stages:result.stages,stampResults:result.stampResults||[],sourceHash:result.sourceHash,outputHash:result.outputHash,outputByteLength:result.bytes?.byteLength||0,label:result.label,recordUnchanged:JSON.stringify(before)===JSON.stringify(after)});
    }catch(error){return Response.json({ok:false,errorClass:error?.name||"Error"} ,500);}
  }
};