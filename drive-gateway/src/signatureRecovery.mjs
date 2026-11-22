import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { canonicalJson, sha256Hex, HttpError } from "./util.mjs";
import { resendInvitation } from "./signing.mjs";
import { cleanText, randomHex, validateEmail, validateName } from "./util.mjs";

const isOwner=(envelope,user)=>Boolean(user?.uid)&&(envelope.createdBy===user.uid||envelope.createdByUid===user.uid||envelope.ownerUid===user.uid||user.isAdmin===true);
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
  const eligible=(rows||[]).filter(row=>row.status!=="Completed"&&isOwner(row,user))
    .sort((a,b)=>String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||"")));
  const page=eligible.slice(safeOffset,safeOffset+safeLimit);for(const envelope of page)await appendRecoveryAccessEvent(ctx,user,envelope.id,"recovery.queue.viewed");return {ok:true,total:eligible.length,limit:safeLimit,offset:safeOffset,items:page.map(e=>({
    envelopeId:e.id,documentId:e.documentId,title:e.title||"",status:e.status,
    failedAt:e.completionFailure?.failedAt||null,stage:e.completionFailure?.stage||"NOT_RECORDED",
    signerCount:Array.isArray(e.signers)?e.signers.length:0
  }))};
}
async function appendRecoveryAccessEvent(ctx,user,id,type,details={}){
  const current=await ctx.meta.get("envelopes",id);
  if(!current||!isOwner(current,user)||current.status==="Completed")throw new HttpError(409,"Recovery record changed or is no longer eligible; refresh before continuing.");
  const at=ctx.now().toISOString();
  const eventId="recovery-"+id+"-"+Date.parse(at)+"-"+randomHex(8);
  await ctx.meta.create("recoveryAccessEvents",eventId,{envelopeId:id,type,actor:user.uid,at,...details});
}
async function loadOwnedIncompleteEnvelope(ctx,user,id){
  if(!user?.uid)throw new HttpError(401,"Authentication required.");
  const envelope=await ctx.meta.get("envelopes",id);
  if(!envelope)throw new HttpError(404,"Recovery record not found.");
  if(!isOwner(envelope,user))throw new HttpError(403,"This envelope belongs to another owner.");
  if(envelope.status==="Completed")throw new HttpError(409,"Completed envelopes do not require recovery assessment.");
  return envelope;
}
async function loadOwnedFailedEnvelope(ctx,user,id){
  const envelope=await loadOwnedIncompleteEnvelope(ctx,user,id);
  if(envelope.status!=="CompletionFailed")throw new HttpError(409,"Only failed-completion envelopes can enter a recovery action.");
  if(!await validChain(envelope.events))throw new HttpError(409,"The signing audit chain failed verification; recovery action is blocked.");
  return envelope;
}
function safeFailure(envelope){
  const failure=envelope.completionFailure||{};
  const raw=String(failure.stage||"").toUpperCase();
  const stage=/PDF|BUILD|RENDER/.test(raw)?"PDF_BUILD":/HASH|INTEGRITY/.test(raw)?"HASH":/ARCHIVE|DRIVE|COPY/.test(raw)?"ARCHIVE":/CERT/.test(raw)?"CERTIFICATE":/DISTRIB/.test(raw)?"DISTRIBUTION":/SEND|MAIL|SMTP|INVIT/.test(raw)?"SEND":"NOT_RECORDED";
  const errorCode=String(failure.errorCode||failure.errorType||"NOT_RECORDED").toUpperCase().replace(/[^A-Z0-9_]/g,"").slice(0,48)||"NOT_RECORDED";
  return {stage,errorCode,failedAt:typeof failure.failedAt==="string"?failure.failedAt:null};
}
export async function assessRecoveryEvidence(ctx,user,id){
  const envelope=await loadOwnedIncompleteEnvelope(ctx,user,id);
  const auditChainValid=await validChain(envelope.events);
  const document=await ctx.meta.get("documents",envelope.documentId);
  let sourceHash=null,sourceHashValid=false,sourceHashReason="Original source document reference is unavailable.";
  if(document?.primaryStorageId){
    const original=await ctx.storage.get(document.primaryStorageId);
    if(original){
      sourceHash=await sha256Hex(original);
      sourceHashValid=sourceHash===document.sha256&&sourceHash===envelope.documentHash;
      sourceHashReason=sourceHashValid?"Original source hash matches the document and envelope records.":"Original source hash does not match the retained document/envelope hash.";
    }else sourceHashReason="Original source document is unavailable in protected storage.";
  }
  const rows=[];
  for(const [index,field] of (envelope.fields||[]).entries()){
    if(!["Signature","Initials"].includes(field.type))continue;
    const base={fieldId:field.fieldId||null,fieldNumber:index+1,page:Number(field.page||1),signerId:field.signerId||null};
    if(!auditChainValid){rows.push({...base,status:"UNVERIFIABLE",reason:"The signing audit chain failed verification; stamp evidence cannot be trusted."});continue;}
    const signer=(envelope.signers||[]).find(s=>field.signerId?s.id===field.signerId:Boolean(s.uid&&s.uid===field.signerUid));
    if(!signer){rows.push({...base,status:"MISSING",reason:"Assigned signer record is unavailable."});continue;}
    const event=signedEvent(envelope,signer.id);
    if(signer.status!=="Signed"||!signer.signedAt||!event){rows.push({...base,signerId:signer.id,status:"MISSING",reason:"No completed signer action is recorded for this stamp slot."});continue;}
    const value=signer.fieldValues?.[field.fieldId];
    if(typeof value!=="string"||!value){rows.push({...base,signerId:signer.id,status:"UNVERIFIABLE",reason:"The stored signature field value is unavailable."});continue;}
    const expected=await sha256Hex(value);
    const roleEvidenceEvent=(envelope.events||[]).filter(item=>item.type==="signer.role_assignment.completed"&&item.signerId===signer.id&&Number(item.roleAssignmentIndex||0)===Number(field.roleAssignmentIndex||0))
      .find(item=>(item.signatureFieldHashes||[]).some(value=>value.fieldId===field.fieldId&&value.type===field.type));
    const roleEvidence=(roleEvidenceEvent?.signatureFieldHashes||[]).find(value=>value.fieldId===field.fieldId&&value.type===field.type);
    const signatureHashMatches=event.signatureHash===await sha256Hex(signer.signatureValue||"")&&event.at===signer.signedAt;
    if(!signatureHashMatches){rows.push({...base,signerId:signer.id,status:"FAILED",reason:"The signed-event signature hash does not match retained signer evidence."});continue;}
    if(!roleEvidence||roleEvidence.hash!==expected){rows.push({...base,signerId:signer.id,status:"UNVERIFIABLE",reason:"The audit chain does not contain a matching field-level signature hash."});continue;}
    rows.push({...base,signerId:signer.id,status:"PASS",reason:"Field value, signer action and chained field-level hash agree."});
  }
  const failure=safeFailure(envelope);
  await appendRecoveryAccessEvent(ctx,user,id,"recovery.evidence.assessed",{verifiedStampCount:rows.filter(x=>x.status==="PASS").length,nonVerifiedStampCount:rows.filter(x=>x.status!=="PASS").length});
  return {ok:true,envelopeId:id,envelopeStatus:envelope.status,documentTitle:cleanText(envelope.title||"",180),sourceHash,sourceHashValid,sourceHashReason,auditChainValid,completionFailure:failure,stampSlots:rows,summary:{
    pass:rows.filter(x=>x.status==="PASS").length,
    failed:rows.filter(x=>x.status==="FAILED").length,
    missing:rows.filter(x=>x.status==="MISSING").length,
    unverifiable:rows.filter(x=>x.status==="UNVERIFIABLE").length
  }};
}
export async function reassignRecoveryStampSlots(ctx,user,id,{signerId,fieldIds,email,name,reason}={}){
  const envelope=await loadOwnedFailedEnvelope(ctx,user,id);
  if(envelope.emailSigningModule!=="v2")throw new HttpError(409,"Targeted recovery reassignment requires the verified email-link signing module.");
  if(typeof ctx.sendInvitation!=="function"||!ctx.config?.appUrl)throw new HttpError(503,"The protected recovery invitation service is not configured.");
  const assessment=await assessRecoveryEvidence(ctx,user,id);
  const requested=[...new Set(Array.isArray(fieldIds)?fieldIds.map(value=>String(value)):[])];
  if(!requested.length||requested.length>20||requested.some(value=>!value||value.length>100))throw new HttpError(400,"Select one or more specific signature fields for reassignment.");
  const target=(await ctx.meta.get("envelopes",id))?.signers?.find(item=>item.id===String(signerId||""));
  if(!target||target.status!=="Signed")throw new HttpError(409,"Only a previously signed assignment can be reassigned in this recovery path.");
  const rows=new Map(assessment.stampSlots.map(row=>[row.fieldId,row]));
  for(const fieldId of requested){
    const row=rows.get(fieldId);
    if(!row||row.signerId!==target.id||row.status==="PASS")throw new HttpError(409,"A selected field is not an eligible failed stamp slot for this signer.");
  }
  const replacementEmail=validateEmail(email).trim().toLowerCase();
  if(replacementEmail===String(target.email||"").trim().toLowerCase())throw new HttpError(400,"Use a different email identity for the replacement signer.");
  const replacementName=validateName(name);
  const cleanReason=cleanText(reason||"",300);
  if(cleanReason.length<10)throw new HttpError(400,"Provide a recovery reason of at least 10 characters.");
  const current=await ctx.meta.get("envelopes",id);
  if(!current||!isOwner(current,user)||current.status!=="CompletionFailed"||!await validChain(current.events))throw new HttpError(409,"The recovery record changed; refresh and reassess before reassignment.");
  const fieldsToMove=(current.fields||[]).filter(field=>requested.includes(field.fieldId)&&field.signerId===target.id);
  if(fieldsToMove.length!==requested.length)throw new HttpError(409,"A selected stamp field changed assignment; no reassignment was made.");
  const roleIndexes=[...new Set(fieldsToMove.map(field=>Number(field.roleAssignmentIndex||0)))].sort((a,b)=>a-b);
  const replacementRoles=roleIndexes.map(index=>({...((target.roleAssignments||[])[index]||{role:"Signer"})}));
  const nextNumber=Math.max(0,...(current.signers||[]).map(item=>Number(String(item.id||"").match(/^S([0-9]+)$/)?.[1]||0)))+1;
  const newSignerId="S"+nextNumber;
  if((current.signers||[]).some(item=>item.id===newSignerId))throw new HttpError(409,"A replacement signer identifier already exists.");
  const now=ctx.now(),ttlDays=Math.max(1,Math.min(30,Number(ctx.config.emailLinkTtlDays)||7)),expiresAt=new Date(now.getTime()+ttlDays*86400000).toISOString();
  const replacement={id:newSignerId,email:replacementEmail,emailHash:await sha256Hex(replacementEmail),profileUid:null,name:replacementName,title:"",declaredParticulars:{name:replacementName,title:"",occupation:"",capacity:""},roleAssignments:replacementRoles,order:target.order,uid:null,status:"Pending",identityType:"email-link",tokenHash:await sha256Hex(randomHex(32)),tokenExpiresAt:expiresAt,emailLinkExpiresAt:expiresAt,emailLinkStatus:"issued",emailLinkSessionStatus:"revoked",emailLinkSessionHash:null,emailLinkTokenHistory:[],emailLinkAttemptCount:0,emailLinkOpenCount:0,emailLinkIpAttempts:{},invitation:"Pending"};
  const retainedField=assessment.stampSlots.find(row=>row.signerId===target.id&&row.status==="PASS"&&!requested.includes(row.fieldId));
  const retainedValue=retainedField?target.fieldValues?.[retainedField.fieldId]:null;
  const nextSigners=(current.signers||[]).map(item=>item.id===target.id?{...item,certificateSignatureValue:retainedValue||"Stamp not verified — reassigned",certificateSignatureType:typeof retainedValue==="string"&&retainedValue.startsWith("data:image/png;base64,")?"drawn":"typed"}:item);
  const mappedFields=(current.fields||[]).map(field=>{
    if(!requested.includes(field.fieldId))return field;
    return {...field,signerId:newSignerId,signerUid:null,roleAssignmentIndex:roleIndexes.indexOf(Number(field.roleAssignmentIndex||0))};
  });
  const at=now.toISOString();
  const eventBody={type:"recovery.stamp.reassigned",actor:user.uid,at,previousSignerId:target.id,replacementSignerId:newSignerId,fieldIds:requested,reason:cleanReason,replacementEmailHash:replacement.emailHash,prevHash:current.events.length?current.events.at(-1).hash:"GENESIS"};
  const event={...eventBody,hash:await sha256Hex(canonicalJson(eventBody))};
  await ctx.meta.update("envelopes",id,{signers:[...nextSigners,replacement],fields:mappedFields,events:[...(current.events||[]),event],updatedAt:at},{ifVersion:current._v});
  const delivery=await resendInvitation(ctx,user,id,newSignerId,{invitationKind:"recovery-reassignment"});
  return {ok:true,envelopeId:id,previousSignerId:target.id,replacementSignerId:newSignerId,reassignedFieldIds:requested,deliveryStatus:delivery.deliveryStatus,expiresAt:delivery.expiresAt};
}
export async function buildRecoveryPreview(ctx,user,id){
  const envelope=await loadOwnedFailedEnvelope(ctx,user,id);
  const assessment=await assessRecoveryEvidence(ctx,user,id);
  const document=await ctx.meta.get("documents",envelope.documentId);
  const original=await ctx.storage.get(document.primaryStorageId);
  const verifiedIds=new Set(assessment.stampSlots.filter(x=>x.status==="PASS").map(x=>x.fieldId));
  const safeFields=(envelope.fields||[]).filter(field=>verifiedIds.has(field.fieldId));
  const safeSignerIds=new Set(safeFields.map(field=>field.signerId));
  const safeSigners=(envelope.signers||[]).filter(signer=>safeSignerIds.has(signer.id)).map(signer=>{
    const verifiedField=safeFields.find(field=>field.signerId===signer.id);
    const verifiedValue=verifiedField?signer.fieldValues?.[verifiedField.fieldId]:null;
    return {...signer,certificateSignatureValue:verifiedValue||signer.signatureValue,certificateSignatureType:typeof verifiedValue==="string"&&verifiedValue.startsWith("data:image/png;base64,")?"drawn":signer.signatureType,fieldValues:Object.fromEntries(Object.entries(signer.fieldValues||{}).filter(([fieldId])=>verifiedIds.has(fieldId)))};
  });
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
  const bytes=await pdf.save({useObjectStreams:false});await appendRecoveryAccessEvent(ctx,user,id,"recovery.preview.generated",{verifiedStampCount:assessment.summary.pass});return {bytes,assessment};
}
