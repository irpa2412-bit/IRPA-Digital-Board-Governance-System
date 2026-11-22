import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { canonicalJson, sha256Hex, HttpError } from "./util.mjs";
import { VersionConflict } from "./adapters.mjs";

const isOwner=(envelope,user)=>Boolean(user?.uid)&&(envelope.createdBy===user.uid||user.isAdmin===true);
async function validChain(events){
  if(!Array.isArray(events))return false;
  let previous="GENESIS";
  for(const event of events){
    if(!event||typeof event!=="object"||typeof event.hash!=="string")return false;
    const {hash,...body}=event;
    if(body.prevHash!==previous||await sha256Hex(canonicalJson(body))!==hash)return false;
    previous=hash;
  }
  return true;
}
function signedEvent(envelope,signerId){
  return (envelope.events||[]).filter(event=>event.type==="signer.signed"&&event.signerId===signerId).at(-1)||null;
}
export async function getRecoveryQueue(ctx,user,{limit=25,offset=0}={}){
  if(!user?.uid)throw new HttpError(401,"Authentication required.");
  const safeLimit=Math.max(1,Math.min(50,limit==null?25:(Number.isInteger(Number(limit))?Number(limit):25)));
  const safeOffset=Math.max(0,Math.min(10000,Number.isInteger(Number(offset))?Number(offset):0));
  const rows=await ctx.meta.list("envelopes");
  const eligible=(rows||[]).filter(row=>row.status==="CompletionFailed"&&isOwner(row,user))
    .sort((a,b)=>String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||"")));
  const page=eligible.slice(safeOffset,safeOffset+safeLimit);for(const envelope of page)await appendRecoveryAccessEvent(ctx,user,envelope.id,"recovery.queue.viewed");return {ok:true,total:eligible.length,limit:safeLimit,offset:safeOffset,items:page.map(e=>({
    envelopeId:e.id,documentId:e.documentId,title:e.title||"",status:e.status,
    failedAt:e.completionFailure?.failedAt||null,stage:e.completionFailure?.stage||"NOT_RECORDED",
    signerCount:Array.isArray(e.signers)?e.signers.length:0
  }))};
}
async function appendRecoveryAccessEvent(ctx,user,id,type,details={}){
  for(let attempt=0;attempt<5;attempt++){
    const current=await ctx.meta.get("envelopes",id);
    if(!current||!isOwner(current,user)||current.status!=="CompletionFailed")throw new HttpError(409,"Recovery record changed; refresh before continuing.");
    if(!await validChain(current.events))throw new HttpError(409,"The signing audit chain failed verification; recovery is blocked.");
    const at=ctx.now().toISOString();
    const body={type,actor:user.uid,at,...details,prevHash:current.events.length?current.events.at(-1).hash:"GENESIS"};
    const event={...body,hash:await sha256Hex(canonicalJson(body))};
    try{
      await ctx.meta.update("envelopes",id,{events:[...(current.events||[]),event],updatedAt:at},{ifVersion:current._v});
      return;
    }catch(error){if(!(error instanceof VersionConflict)||attempt===4)throw error;}
  }
}
async function loadOwnedFailedEnvelope(ctx,user,id){
  const envelope=await ctx.meta.get("envelopes",id);
  if(!envelope||!isOwner(envelope,user))throw new HttpError(404,"Recovery record not found.");
  if(envelope.status!=="CompletionFailed")throw new HttpError(409,"Only failed-completion envelopes can enter recovery.");
  if(!await validChain(envelope.events))throw new HttpError(409,"The signing audit chain failed verification; recovery is blocked.");
  return envelope;
}
export async function assessRecoveryEvidence(ctx,user,id){
  const envelope=await loadOwnedFailedEnvelope(ctx,user,id);
  const document=await ctx.meta.get("documents",envelope.documentId);
  if(!document||!document.primaryStorageId)throw new HttpError(409,"The original source document reference is unavailable.");
  const original=await ctx.storage.get(document.primaryStorageId);
  if(!original)throw new HttpError(409,"The original source document is unavailable.");
  const sourceHash=await sha256Hex(original);
  if(sourceHash!==document.sha256||sourceHash!==envelope.documentHash)throw new HttpError(409,"The original source document integrity check failed.");
  const rows=[];
  for(const field of envelope.fields||[]){
    if(!["Signature","Initials"].includes(field.type))continue;
    const signer=(envelope.signers||[]).find(s=>s.id===field.signerId||(s.uid&&s.uid===field.signerUid));
    if(!signer){rows.push({fieldId:field.fieldId,signerId:field.signerId||null,status:"MISSING",reason:"Assigned signer record is unavailable."});continue;}
    const event=signedEvent(envelope,signer.id);
    if(signer.status!=="Signed"||!signer.signedAt||!event){rows.push({fieldId:field.fieldId,signerId:signer.id,status:"MISSING",reason:"No completed signer action is recorded for this stamp slot."});continue;}
    const value=signer.fieldValues?.[field.fieldId];
    if(typeof value!=="string"||!value){rows.push({fieldId:field.fieldId,signerId:signer.id,status:"UNVERIFIABLE",reason:"The stored signature field value is unavailable."});continue;}
    const expected=await sha256Hex(value);
    const roleEvidence=(envelope.events||[]).filter(item=>item.type==="signer.role_assignment.completed"&&item.signerId===signer.id)
      .flatMap(item=>Array.isArray(item.signatureFieldHashes)?item.signatureFieldHashes:[])
      .find(item=>item.fieldId===field.fieldId);
    const signatureHashMatches=event.signatureHash===await sha256Hex(signer.signatureValue||"");
    if(!signatureHashMatches){rows.push({fieldId:field.fieldId,signerId:signer.id,status:"INVALID",reason:"The signed-event signature hash does not match the retained signer evidence."});continue;}
    if(!roleEvidence||roleEvidence.hash!==expected){rows.push({fieldId:field.fieldId,signerId:signer.id,status:"UNVERIFIABLE",reason:"The audit chain does not contain a matching field-level signature hash."});continue;}
    rows.push({fieldId:field.fieldId,signerId:signer.id,status:"VERIFIED_EXISTING",reason:"Field value, signer action, and chained field-level hash agree."});
  }
  await appendRecoveryAccessEvent(ctx,user,id,"recovery.evidence.assessed",{verifiedStampCount:rows.filter(x=>x.status==="VERIFIED_EXISTING").length,nonVerifiedStampCount:rows.filter(x=>x.status!=="VERIFIED_EXISTING").length});
  return {ok:true,envelopeId:id,sourceHash,auditChainValid:true,stampSlots:rows,summary:{
    verified:rows.filter(x=>x.status==="VERIFIED_EXISTING").length,
    missing:rows.filter(x=>x.status==="MISSING").length,
    invalid:rows.filter(x=>x.status==="INVALID").length,
    unverifiable:rows.filter(x=>x.status==="UNVERIFIABLE").length
  }};
}
export async function buildRecoveryPreview(ctx,user,id){
  const envelope=await loadOwnedFailedEnvelope(ctx,user,id);
  const assessment=await assessRecoveryEvidence(ctx,user,id);
  const document=await ctx.meta.get("documents",envelope.documentId);
  const original=await ctx.storage.get(document.primaryStorageId);
  const verifiedIds=new Set(assessment.stampSlots.filter(x=>x.status==="VERIFIED_EXISTING").map(x=>x.fieldId));
  const safeFields=(envelope.fields||[]).filter(field=>verifiedIds.has(field.fieldId));
  const safeSignerIds=new Set(safeFields.map(field=>field.signerId));
  const safeSigners=(envelope.signers||[]).filter(signer=>safeSignerIds.has(signer.id)).map(signer=>({
    ...signer,fieldValues:Object.fromEntries(Object.entries(signer.fieldValues||{}).filter(([fieldId])=>verifiedIds.has(fieldId)))
  }));
  const {buildSignedPdf}=await import("./pdf.mjs");
  const preview=await buildSignedPdf(original,{
    envelopeId:envelope.id,documentId:envelope.documentId,title:envelope.title||"Recovery preview",
    originalHash:assessment.sourceHash,chainHead:envelope.events.at(-1)?.hash||"GENESIS",
    events:[],completedAt:"RECOVERY PREVIEW — NOT COMPLETED",
    signers:safeSigners,fields:safeFields
  });
  const pdf=await PDFDocument.load(preview);
  pdf.setTitle("RECOVERY PREVIEW - NOT COMPLETED");
  pdf.setSubject("Non-authoritative recovery preview; not a completed or archived document.");
  const font=await pdf.embedFont(StandardFonts.HelveticaBold);
  for(const page of pdf.getPages()){
    const {width,height}=page.getSize();
    page.drawText("RECOVERY PREVIEW — NOT COMPLETED",{x:Math.max(18,width*0.12),y:height*0.48,size:Math.max(18,Math.min(30,width/18)),font,color:rgb(0.78,0.12,0.12),opacity:0.42,rotate:{type:"degrees",angle:32}});
    page.drawText("NON-AUTHORITATIVE COPY",{x:24,y:18,size:9,font,color:rgb(0.65,0.08,0.08),opacity:0.8});
  }
  const bytes=await pdf.save({useObjectStreams:false});await appendRecoveryAccessEvent(ctx,user,id,"recovery.preview.generated",{verifiedStampCount:assessment.summary.verified});return {bytes,assessment};
}
