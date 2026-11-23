import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { canonicalJson, sha256Hex, HttpError } from "./util.mjs";
import { resendInvitation } from "./signing.mjs";
import { cleanText, randomHex, validateEmail, validateName } from "./util.mjs";
import { matchRecoveryEvidenceRoute } from "./esignPathPolicy.mjs";
import { buildUnarchivedCompletedCopy } from "./courtRecoveryCopy.mjs";
import { buildSignedPdf } from "./pdf.mjs";
import { verifyCertificateInput, verifyCertificatePageText, extractLastPdfPageText } from "./recoveryCertificateVerifier.mjs";

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
  if(!await validChain(envelope.events))throw new HttpError(409,"The signing audit chain failed verification; recovery is blocked.");
  return envelope;
}
export async function assessRecoveryEvidence(ctx,user,id,{recordAccess=true}={}){
  const envelope=await loadOwnedIncompleteEnvelope(ctx,user,id);
  const events=Array.isArray(envelope.events)?envelope.events:[];
  const auditChainStatus=events.length===0?"NO_EVENTS":(await validChain(events)?"VERIFIED":"FAILED");
  const document=await ctx.meta.get("documents",envelope.documentId);
  const expectedHashes=[...new Set([document?.sha256,document?.hash,envelope.documentHash,envelope.originalHash].filter(value=>typeof value==="string"&&value.trim()).map(value=>value.trim().toLowerCase()))];
  let sourceHash=null,sourceHashStatus="NO_STORED_HASH",sourceHashCode="SOURCE_HASH_MISSING",sourceHashReason="No stored source hash is available.";
  if(document?.primaryStorageId){
    try{
      const original=await ctx.storage.get(document.primaryStorageId);
      if(original){
        sourceHash=await sha256Hex(original);
        if(!expectedHashes.length){sourceHashStatus="NO_STORED_HASH";sourceHashCode="SOURCE_HASH_MISSING";sourceHashReason="The source file exists, but no stored reference hash is available.";}
        else if(expectedHashes.every(expected=>sourceHash===expected)){sourceHashStatus="VERIFIED";sourceHashCode="SOURCE_HASH_VERIFIED";sourceHashReason="The original source file matches every stored reference hash.";}
        else{sourceHashStatus="MISMATCH";sourceHashCode="SOURCE_HASH_MISMATCH";sourceHashReason="The original source file does not match its stored hash.";}
      }else{sourceHashStatus="SOURCE_FILE_MISSING";sourceHashCode="SOURCE_FILE_MISSING";sourceHashReason="The original source file is not available in storage.";}
    }catch{sourceHashStatus="SOURCE_READ_FAILED";sourceHashCode="SOURCE_READ_FAILED";sourceHashReason="The original source file could not be read from storage.";}
  }else{sourceHashStatus=document?"SOURCE_REFERENCE_MISSING":"SOURCE_DOCUMENT_MISSING";sourceHashCode="SOURCE_REFERENCE_MISSING";sourceHashReason=document?"The source document has no stored file reference.":"The source document record is not available.";}
  const rows=[];
  for(const field of envelope.fields||[]){
    if(!["Signature","Initials"].includes(field.type))continue;
    const signer=(envelope.signers||[]).find(s=>field.signerId?s.id===field.signerId:Boolean(s.uid&&s.uid===field.signerUid));
    const page=Number(field.page||0)||null;
    if(auditChainStatus==="FAILED"){rows.push({fieldId:field.fieldId,page,signerId:field.signerId||null,status:"UNVERIFIABLE",code:"STAMP_AUDIT_CHAIN_FAILED",reason:"The signing audit chain failed verification."});continue;}
    if(!signer){rows.push({fieldId:field.fieldId,page,signerId:field.signerId||null,status:"MISSING",code:"STAMP_SIGNER_MISSING",reason:"Assigned signer record is unavailable."});continue;}
    const event=signedEvent(envelope,signer.id);
    if(signer.status!=="Signed"||!signer.signedAt||!event){rows.push({fieldId:field.fieldId,page,signerId:signer.id,status:"MISSING",code:"STAMP_SIGN_EVENT_MISSING",reason:"No completed signer action is recorded for this stamp slot."});continue;}
    const value=signer.fieldValues?.[field.fieldId];
    if(typeof value!=="string"||!value){rows.push({fieldId:field.fieldId,page,signerId:signer.id,status:"UNVERIFIABLE",code:"STAMP_VALUE_MISSING",reason:"The stored signature field value is unavailable."});continue;}
    const expected=await sha256Hex(value);
    const roleEvent=events.filter(item=>item.type==="signer.role_assignment.completed"&&item.signerId===signer.id&&Number(item.roleAssignmentIndex||0)===Number(field.roleAssignmentIndex||0)).find(item=>(item.signatureFieldHashes||[]).some(value=>value.fieldId===field.fieldId&&value.type===field.type));
    const roleEvidence=(roleEvent?.signatureFieldHashes||[]).find(value=>value.fieldId===field.fieldId&&value.type===field.type);
    const signatureHashMatches=event.signatureHash===await sha256Hex(signer.signatureValue||"")&&event.at===signer.signedAt;
    if(!signatureHashMatches){rows.push({fieldId:field.fieldId,page,signerId:signer.id,status:"INVALID",resultStatus:"FAILED",code:"STAMP_SIGNATURE_HASH_MISMATCH",reason:"The signed-event signature hash does not match the retained signer evidence."});continue;}
    if(!roleEvidence||roleEvidence.hash!==expected){rows.push({fieldId:field.fieldId,page,signerId:signer.id,status:"UNVERIFIABLE",code:"STAMP_FIELD_HASH_UNAVAILABLE",reason:"The audit chain does not contain a matching field-level signature hash."});continue;}
    rows.push({fieldId:field.fieldId,page,signerId:signer.id,status:"VERIFIED_EXISTING",resultStatus:"PASS",code:"STAMP_VERIFIED",reason:"Field value, signer action, and chained field-level hash agree."});
  }
  const rawStage=String(envelope.completionFailure?.stage||"").toUpperCase();
  const stageMap=[["PDF","PDF_BUILD"],["HASH","HASH"],["ARCHIVE","ARCHIVE"],["CERTIFICATE","CERTIFICATE"],["DISTRIBUT","DISTRIBUTION"]];
  const finalisationStage=stageMap.find(([needle])=>rawStage.includes(needle))?.[1]||"NOT_RECORDED";
  const storedFinalisationRecord=envelope.finalisationRecord&&typeof envelope.finalisationRecord==="object"&&!Array.isArray(envelope.finalisationRecord)?envelope.finalisationRecord:{};
  const allowedFinalisationStages=new Set(["PDF_BUILD","HASH","ARCHIVE","CERTIFICATE","DISTRIBUTION"]);
  const storedStageMap=storedFinalisationRecord.stages&&typeof storedFinalisationRecord.stages==="object"&&!Array.isArray(storedFinalisationRecord.stages)?storedFinalisationRecord.stages:{};
  const finalisationStages=Object.entries(storedStageMap).map(([stageCode,entry])=>{
    const validStage=allowedFinalisationStages.has(stageCode)&&entry?.stageCode===stageCode;
    const status=["PASS","FAILED"].includes(entry?.status)?entry.status:"INVALID";
    const errorCode=entry?.errorCode==null?null:String(entry.errorCode).replace(/[^A-Z0-9_-]/gi,"").slice(0,48)||"STAGE_FAILED";
    const errorMessage=entry?.errorMessage==null?null:String(entry.errorMessage).replace(/Bearer\s+\S+/gi,"Bearer [REDACTED]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[REDACTED EMAIL]").replace(/https?:\/\/\S+/gi,"[URL REDACTED]").slice(0,180);
    const recordedAt=typeof entry?.recordedAt==="string"&&Number.isFinite(Date.parse(entry.recordedAt))?entry.recordedAt:null;
    return {stageCode,stageCodeValid:validStage,status,errorCode,errorMessage,recordedAt};
  });
  const hasFinalisationRecord=Object.keys(storedFinalisationRecord).length>0;
  const latestStage=storedFinalisationRecord.latestStage==null?null:String(storedFinalisationRecord.latestStage);
  const firstFailedStage=storedFinalisationRecord.firstFailedStage==null?null:String(storedFinalisationRecord.firstFailedStage);
  const hasFailedStage=finalisationStages.some(entry=>entry.status==="FAILED");
  const latestStageValid=latestStage!==null&&allowedFinalisationStages.has(latestStage)&&Object.prototype.hasOwnProperty.call(storedStageMap,latestStage);
  const failedStagePointerValid=hasFailedStage
    ?firstFailedStage!==null&&allowedFinalisationStages.has(firstFailedStage)&&storedStageMap[firstFailedStage]?.status==="FAILED"
    :firstFailedStage===null;
  const stageRecordIntegrityValid=finalisationStages.length>0&&finalisationStages.every(entry=>entry.stageCodeValid&&entry.status!=="INVALID"&&entry.recordedAt!==null)&&latestStageValid&&failedStagePointerValid;
  const stageRecordIntegrity={status:!hasFinalisationRecord?"NOT_PRESENT":stageRecordIntegrityValid?"CONSISTENT":"INCONSISTENT",entryCount:finalisationStages.length,firstFailedStageMeaning:"FIRST_FAILED_ENTRY_IN_STORED_MAP_NOT_PROVEN_CHRONOLOGY"};
  const pendingRecord=envelope.completion?.archivePending&&typeof envelope.completion.archivePending==="object"?envelope.completion.archivePending:null;
  const pendingHash=String(pendingRecord?.finalHash||"").trim().toLowerCase();
  const pendingFileName=String(pendingRecord?.fileName||"").split(/[\\\\/]/).pop().slice(0,120)||null;
  const environmentClass=value=>{
    const normalized=String(value||"").trim().toUpperCase();
    if(["ACTUAL","TRIAL","TEST"].includes(normalized))return normalized;
    if(normalized==="PRODUCTION")return "LEGACY_PRODUCTION";
    if(!normalized)return "MISSING";
    return "UNRECOGNIZED";
  };
  const runtimeEnvironment=String(ctx.env?.IRPA_ENVIRONMENT||"").trim().toLowerCase();
  const runtimeDataEnvironment=runtimeEnvironment==="staging"?"TRIAL":runtimeEnvironment==="production"?"ACTUAL":runtimeEnvironment==="trial"?"TRIAL":runtimeEnvironment==="actual"?"ACTUAL":runtimeEnvironment==="test"?"TEST":null;
  const envelopeEnvironment=environmentClass(envelope.dataEnvironment);
  const pendingEnvironment=environmentClass(pendingRecord?.environment);
  const expectedEnvironment=environmentClass(runtimeDataEnvironment);
  const environmentDiagnostics={envelope:envelopeEnvironment,preservedCopy:pendingEnvironment,gatewayExpected:expectedEnvironment,allMatch:Boolean(runtimeDataEnvironment)&&["ACTUAL","TRIAL","TEST"].includes(envelopeEnvironment)&&envelopeEnvironment===pendingEnvironment&&envelopeEnvironment===expectedEnvironment};
  let artifactIntegrityStatus="NOT_CHECKED";
  if(pendingRecord?.storageId&&/^[a-f0-9]{64}$/.test(pendingHash)){
    try{
      const pendingBytes=await ctx.storage.get(pendingRecord.storageId);
      if(!(pendingBytes instanceof Uint8Array)||!pendingBytes.length)artifactIntegrityStatus="MISSING";
      else artifactIntegrityStatus=(await sha256Hex(pendingBytes))===pendingHash?"MATCH":"MISMATCH";
    }catch{artifactIntegrityStatus="READ_FAILED";}
  }else if(pendingRecord?.storageId)artifactIntegrityStatus="RECORDED_HASH_INVALID";
  else if(pendingRecord)artifactIntegrityStatus="STORAGE_REFERENCE_MISSING";
  const archivePending={metadataPresent:Boolean(pendingRecord),storageReferencePresent:Boolean(pendingRecord?.storageId),recordedHashPresent:/^[a-f0-9]{64}$/.test(pendingHash),recordedHash:/^[a-f0-9]{64}$/.test(pendingHash)?pendingHash:null,fileName:pendingFileName,createdAt:typeof pendingRecord?.createdAt==="string"?pendingRecord.createdAt:null,environment:pendingRecord?.environment?String(pendingRecord.environment).toUpperCase():null,artifactBytesVerified:artifactIntegrityStatus==="MATCH",artifactIntegrityStatus};
  if(recordAccess&&auditChainStatus==="VERIFIED"){try{await appendRecoveryAccessEvent(ctx,user,id,"recovery.evidence.assessed",{verifiedStampCount:rows.filter(x=>x.status==="VERIFIED_EXISTING").length,nonVerifiedStampCount:rows.filter(x=>x.status!=="PASS").length});}catch{}}
  return {ok:true,envelopeId:id,title:envelope.title||"",status:envelope.status,auditChain:{status:auditChainStatus,code:auditChainStatus==="VERIFIED"?"AUDIT_CHAIN_VERIFIED":auditChainStatus==="FAILED"?"AUDIT_CHAIN_FAILED":"AUDIT_CHAIN_NO_EVENTS"},auditChainValid:auditChainStatus==="VERIFIED",sourceHash,sourceHashStatus,sourceHashCode,sourceHashReason,finalisationStage,finalisationStageCode:rawStage||"FINALISATION_STAGE_NOT_RECORDED",completionFailure:{stage:envelope.completionFailure?.stage||null,failedAt:envelope.completionFailure?.failedAt||null},finalisationRecord:{latestStage,firstFailedStage,updatedAt:typeof storedFinalisationRecord.updatedAt==="string"?storedFinalisationRecord.updatedAt:null,stages:finalisationStages},stageRecordIntegrity,environmentDiagnostics,archivePending,stampSlots:rows,summary:{verified:rows.filter(x=>x.resultStatus==="PASS"||x.status==="VERIFIED_EXISTING").length,missing:rows.filter(x=>x.status==="MISSING").length,failed:rows.filter(x=>x.status==="INVALID").length,unverifiable:rows.filter(x=>x.status==="UNVERIFIABLE").length}};
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
    if(!row||row.signerId!==target.id||row.status==="VERIFIED_EXISTING")throw new HttpError(409,"A selected field is not an eligible failed stamp slot for this signer.");
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
  const retainedField=assessment.stampSlots.find(row=>row.signerId===target.id&&row.status==="VERIFIED_EXISTING"&&!requested.includes(row.fieldId));
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
  if(assessment.auditChain.status!=="VERIFIED")throw new HttpError(409,"Preview unavailable because the signing audit chain is not verified.");
  if(assessment.sourceHashStatus!=="VERIFIED")throw new HttpError(409,"Preview unavailable because the original source hash is not verified.");
  const document=await ctx.meta.get("documents",envelope.documentId);
  const original=await ctx.storage.get(document.primaryStorageId);
  const verifiedIds=new Set(assessment.stampSlots.filter(x=>x.status==="VERIFIED_EXISTING").map(x=>x.fieldId));
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
  const bytes=await pdf.save({useObjectStreams:false});await appendRecoveryAccessEvent(ctx,user,id,"recovery.preview.generated",{verifiedStampCount:assessment.summary.verified});return {bytes,assessment};
}



const EMERGENCY_COPY_LABEL="EMERGENCY-RETRIEVAL-COPY, NOT ARCHIVED";
const EMERGENCY_COPY_DISCLAIMER="Cryptographic PDF seal: NOT APPLIED. Emergency retrieval copy, not archived.";
const emergencyOwner=(envelope,user)=>Boolean(user?.uid)&&(envelope.createdBy===user.uid||envelope.createdByUid===user.uid||envelope.ownerUid===user.uid||user.isAdmin===true);
async function appendEmergencyCertificatePage(bytes,events,signers,completedAt){
  const pdf=await PDFDocument.load(bytes);
  const page=pdf.addPage([612,792]);
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  let y=752;
  const write=(value,size=7.5,useBold=false)=>{
    const selected=useBold?bold:font;
    const text=String(value??"");
    const max=Math.max(30,Math.floor(500/(size*0.55)));
    for(let offset=0;offset<text.length;offset+=max){
      if(y<28)throw new Error("EMERGENCY_CERTIFICATE_PAGE_OVERFLOW");
      page.drawText(text.slice(offset,offset+max),{x:48,y,size,font:selected});
      y-=size+3;
    }
  };
  write(EMERGENCY_COPY_LABEL,12,true); y-=8;
  write(EMERGENCY_COPY_DISCLAIMER,9,true);
  write("Completion timestamp: "+completedAt,8);
  write("Verified signer names:",8,true);
  for(const signer of signers)write(signer.name,7.5);
  write("Verified audit-chain timestamps:",8,true);
  for(const event of events)if(typeof event.at==="string"&&event.at.trim())write(event.at,6.5);
  write("Verified audit-chain event hashes:",8,true);
  for(const event of events)if(typeof event.hash==="string")write(event.hash,5.5);
  const output=await pdf.save({useObjectStreams:false});
  return new Uint8Array(output);
}
function emergencyErrorClass(error){
  return String(error?.name||"Error").replace(/[^A-Za-z0-9_]/g,"").slice(0,48)||"Error";
}
export function classifyEmergencyRetrievalError(error,fallback="UNKNOWN"){
  const name=emergencyErrorClass(error),message=String(error?.message||"");
  if(/cpu time|exceeded.*time|timed? ?out|timeout/i.test(message)||name==="TimeoutError"||name==="AbortError")return "TIMEOUT";
  if(/out of memory|memory allocation|array buffer|buffer too large|maximum.*size/i.test(message)||name==="RangeError")return "SIZE_LIMIT";
  if(/png|image decode|invalid image|failed to parse image/i.test(message))return "STAMP_LOAD";
  if(/field.*page|missing pdf page|outside.*page|draw.*image|embed.*image/i.test(message))return "STAMP_RENDER";
  return fallback;
}
const emergencyStepMessages={
  SOURCE_READ:["The original PDF could not be read.","PDF ya awali haikuweza kusomwa."],
  STAMP_LOAD:["A signature image could not be loaded.","Picha ya saini haikuweza kupakiwa."],
  STAMP_RENDER:["A signature image could not be placed on the PDF.","Picha ya saini haikuweza kuwekwa kwenye PDF."],
  PDF_BUILD:["The recovery PDF could not be created.","PDF ya urejeshaji haikuweza kuundwa."],
  HASH:["The SHA-256 integrity check could not be completed.","Ukaguzi wa uadilifu wa SHA-256 haukuweza kukamilishwa."],
  CERT_VERIFY:["The certificate page did not pass verification.","Ukurasa wa cheti haukupita uthibitishaji."],
  TEXT_EXTRACT:["Text could not be read from the certificate page.","Maandishi ya ukurasa wa cheti hayakuweza kusomwa."],
  SIZE_LIMIT:["The recovery PDF exceeded an available processing limit.","PDF ya urejeshaji imezidi kikomo cha uchakataji."],
  TIMEOUT:["The recovery operation exceeded its time limit.","Urejeshaji umevuka muda wa uchakataji."],
  UNKNOWN:["The recovery operation failed unexpectedly.","Urejeshaji umeshindwa bila kutarajiwa."]
};
export async function buildEmergencyRetrieval(ctx,user,id){
  const stages=[];
  const stage=(stageCode,status,errorClass=null)=>stages.push({stageCode,status,errorClass});
  const fail=(step,error)=>{
    const errorType=emergencyErrorClass(error);
    stage(step,"FAILED",errorType);
    return {ok:false,status:Number(error?.status)||409,code:"EMERGENCY_RETRIEVAL_FAILED:"+step,step,errorClass:errorType,messages:emergencyStepMessages[step]||emergencyStepMessages.UNKNOWN,stages};
  };
  try{
    const envelope=await ctx.meta.get("envelopes",id);
    if(!envelope)throw Object.assign(new Error("Recovery record not found."),{status:404});
    if(!emergencyOwner(envelope,user))throw Object.assign(new Error("This envelope belongs to another owner."),{status:403});
    if(envelope.status!=="CompletionFailed")throw Object.assign(new Error("Only failed-completion envelopes are eligible for emergency retrieval."),{status:409});
    const document=await ctx.meta.get("documents",envelope.documentId);
    if(!document?.primaryStorageId)return fail("SOURCE_READ",new Error("SOURCE_REFERENCE_MISSING"));
    let source;
    try{source=await ctx.storage.get(document.primaryStorageId);}catch(error){return fail("SOURCE_READ",error);}
    if(!(source instanceof Uint8Array)||!source.length)return fail("SOURCE_READ",new Error("SOURCE_FILE_MISSING"));
    let sourceHash;
    try{sourceHash=await sha256Hex(source);}catch(error){return fail("HASH",error);}
    const references=[document.sha256,document.hash,envelope.documentHash,envelope.originalHash].filter(value=>typeof value==="string"&&value.trim()).map(value=>value.trim().toLowerCase());
    if(!references.length||references.some(value=>value!==sourceHash))return fail("HASH",new Error("SOURCE_HASH_MISMATCH_OR_REFERENCE_MISSING"));
    stage("SOURCE_READ","PASS");
    stage("SOURCE_HASH","PASS");
    if(!await validChain(envelope.events))return fail("AUDIT_CHAIN",new Error("AUDIT_CHAIN_FAILED"));
    const events=Array.isArray(envelope.events)?envelope.events:[];
    stage("AUDIT_CHAIN","PASS");
    let assessment;
    try{assessment=await assessRecoveryEvidence(ctx,user,id,{recordAccess:false});}catch(error){return fail(classifyEmergencyRetrievalError(error,"STAMP_LOAD"),error);}
    if(assessment.stampSlots.length!==12||assessment.stampSlots.some(row=>row.status!=="VERIFIED_EXISTING"))return fail("STAMP_LOAD",new Error("STAMP_EVIDENCE_NOT_12_FULLY_VERIFIED_STAMPS"));
    stage("STAMP_EVIDENCE","PASS");
    const verifiedIds=new Set(assessment.stampSlots.map(row=>row.fieldId));
    const fields=(envelope.fields||[]).filter(field=>verifiedIds.has(field.fieldId));
    const signers=(envelope.signers||[]).filter(signer=>events.some(event=>event.type==="signer.signed"&&event.signerId===signer.id));
    if(!signers.length)return fail("PDF_BUILD",new Error("NO_VERIFIED_SIGNERS"));
    const completionEvent=[...events].reverse().find(event=>/^(envelope|document|signing)[._-]?(completed|complete)$/i.test(String(event.type||""))&&typeof event.at==="string");
    const completedAt=completionEvent?.at||"NOT RECORDED";
    const info={envelopeId:envelope.id,documentId:envelope.documentId,title:envelope.title||"",originalHash:sourceHash,chainHead:events.at(-1)?.hash||"GENESIS",completedAt,signers,fields,events};
    const inputCheck=verifyCertificateInput(info,events,signers);
    if(!inputCheck.ok)return fail("CERT_VERIFY",new Error("CERTIFICATE_INPUT_MISMATCH"));
    let built;
    try{built=await buildSignedPdf(source,info);}catch(error){return fail(emergencyStepFor(error,"PDF_BUILD"),error);}
    stage("STAMP_RENDER","PASS");
    stage("PDF_BUILD","PASS");
    let output;
    try{output=await appendEmergencyCertificatePage(built,events,signers,completedAt);}catch(error){return fail(emergencyStepFor(error,"PDF_BUILD"),error);}
    let certificateWarning=null;
    let pageText;
    try{pageText=await (ctx.recoveryTextExtractor||extractLastPdfPageText)(new Uint8Array(output));}
    catch(error){
      const errorType=emergencyErrorClass(error);
      certificateWarning={step:"TEXT_EXTRACT",errorClass:errorType,messages:emergencyStepMessages.TEXT_EXTRACT};
      stage("TEXT_EXTRACT","FAILED",errorType);
      stage("CERT_VERIFY","NOT_APPLICABLE",errorType);
    }
    if(pageText!==undefined){
      const certificate=verifyCertificatePageText(pageText,events,signers);
      if(!certificate.ok||!pageText.includes(EMERGENCY_COPY_DISCLAIMER)||!pageText.includes(EMERGENCY_COPY_LABEL)){
        certificateWarning={step:"CERT_VERIFY",errorClass:"CertificateVerificationError",messages:emergencyStepMessages.CERT_VERIFY};
        stage("TEXT_EXTRACT","PASS");
        stage("CERT_VERIFY","FAILED","CertificateVerificationError");
      }else{
        stage("TEXT_EXTRACT","PASS");
        stage("CERT_VERIFY","PASS");
      }
    }
    stage("AUDIT_CHAIN","PASS");
    stage("SOURCE_HASH","PASS");
    stage("STAMP_HASHES","PASS");
    let outputHash;
    try{outputHash=await sha256Hex(output);}catch(error){return fail("HASH",error);}
    stage("OUTPUT_SHA256","PASS");
    const label=certificateWarning
      ?"UNARCHIVED COPY. Certificate page not verified. Audit chain, source hash and 12 stamps verified. The envelope is NOT Completed."
      :"UNARCHIVED COPY. Certificate page verified. Audit chain, source hash and 12 stamps verified. The envelope is NOT Completed.";
    return {ok:true,bytes:output,outputHash,stages,label,certificateWarning,checks:{sourceHash:"PASS",auditChain:"PASS",stampHashes:"PASS",pdfHash:"PASS",certificatePage:certificateWarning?"NOT APPLICABLE":"PASS"},envelopeEnvironment:String(envelope.dataEnvironment||"UNKNOWN").toUpperCase(),preservedEnvironment:String(envelope.completion?.archivePending?.environment||"MISSING").toUpperCase(),workerEnvironment:String(ctx.env?.IRPA_ENVIRONMENT||"UNKNOWN").toUpperCase()};
  }catch(error){
    const status=Number(error?.status)||500;
    const step=emergencyStepFor(error,"UNKNOWN");
    const errorType=emergencyErrorClass(error);
    return {ok:false,status,code:"EMERGENCY_RETRIEVAL_FAILED:"+step,step,errorClass:errorType,messages:emergencyStepMessages[step],stages:[...stages,{stageCode:step,status:"FAILED",errorClass:errorType}]};
  }
}

function maskedRecoveryAddress(value){
  const [local="",domain=""]=String(value||"").split("@");
  if(!domain)return "NOT RECORDED";
  return (local.slice(0,1)||"*")+"***@"+domain;
}
function recoveryTimeEAT(value){
  const date=new Date(value||"");
  if(!Number.isFinite(date.getTime()))return "NOT RECORDED";
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Dar_es_Salaam",dateStyle:"medium",timeStyle:"medium",hour12:false}).format(date)+" EAT";
}
async function buildEmergencyEvidenceReportPdf(ctx,user,id){
  const envelope=await ctx.meta.get("envelopes",id);
  if(!envelope)throw new HttpError(404,"Recovery record not found.");
  if(!emergencyOwner(envelope,user))throw new HttpError(403,"This envelope belongs to another owner.");
  const [assessment,emergency]=await Promise.all([
    assessRecoveryEvidence(ctx,user,id,{recordAccess:false}),
    buildEmergencyRetrieval(ctx,user,id)
  ]);
  const pdf=await PDFDocument.create();
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  let page=pdf.addPage([612,792]),y=752;
  const line=(value,isBold=false,size=9)=>{
    const text=String(value??"").replace(/[^\x20-\x7E]/g,"?");
    const font=isBold?bold:regular;
    const max=Math.max(24,Math.floor(510/(size*0.52)));
    for(let offset=0;offset<text.length;offset+=max){
      if(y<42){page=pdf.addPage([612,792]);y=752;}
      page.drawText(text.slice(offset,offset+max),{x:48,y,size,font});
      y-=size+4;
    }
  };
  const firstLine=emergency.ok?emergency.label:"EMERGENCY RETRIEVAL FAILED: "+(emergency.code||"EMERGENCY_RETRIEVAL_FAILED:UNKNOWN");
  line(firstLine,true,10);
  y-=8;
  line("IRPA EMERGENCY RETRIEVAL EVIDENCE REPORT",true,14);
  line("Document title: "+(envelope.title||"Untitled document"));
  line("Document reference: "+(envelope.documentId||"NOT RECORDED"));
  line("Envelope reference: "+id);
  line("Envelope status: "+String(envelope.status||"UNKNOWN")+" (this report does not complete the envelope)");
  line("Audit chain: "+(assessment.auditChain?.status==="VERIFIED"?"PASS":"FAILED")+" - "+(assessment.auditChain?.status||"NOT RETRIEVED"));
  line("Source hash: "+(assessment.sourceHashStatus==="VERIFIED"?"PASS":"FAILED")+" - "+(assessment.sourceHash||"NOT AVAILABLE"));
  line("PDF copy SHA-256: "+(emergency.outputHash||"NOT APPLICABLE"));
  line("Certificate page: "+(emergency.checks?.certificatePage||"NOT APPLICABLE"));
  line("Environment recorded on envelope: "+String(envelope.dataEnvironment||"NOT RECORDED").toUpperCase());
  line("Environment recorded on preserved copy: "+String(envelope.completion?.archivePending?.environment||"NOT RECORDED").toUpperCase());
  line("Worker environment: "+String(ctx.env?.IRPA_ENVIRONMENT||"NOT RECORDED").toUpperCase());
  y-=6;line("SIGNATURE STAMPS",true,11);
  for(const row of assessment.stampSlots||[]){
    const status=row.status==="VERIFIED_EXISTING"?"PASS":row.status==="UNVERIFIABLE"?"NOT APPLICABLE":"FAILED";
    line(status+" - Page "+(row.page||"UNKNOWN")+" - Field "+(row.fieldId||"UNKNOWN")+" - "+(row.code||"NO_CODE"));
  }
  y-=6;line("SIGNERS AND SIGNING TIMES",true,11);
  for(const signer of envelope.signers||[]){
    line((signer.name||"Name not recorded")+" - "+maskedRecoveryAddress(signer.email)+" - "+recoveryTimeEAT(signer.signedAt));
  }
  y-=6;line("VERIFICATION CHECKS",true,11);
  line("Source hash: "+(emergency.checks?.sourceHash|| (assessment.sourceHashStatus==="VERIFIED"?"PASS":"FAILED")));
  line("Audit chain: "+(emergency.checks?.auditChain|| (assessment.auditChain?.status==="VERIFIED"?"PASS":"FAILED")));
  line("12 field-level stamp hashes: "+(emergency.checks?.stampHashes||"FAILED"));
  line("Certificate page: "+(emergency.checks?.certificatePage||"NOT APPLICABLE"));
  line("Output PDF SHA-256: "+(emergency.checks?.pdfHash||"NOT APPLICABLE"));
  if(emergency.certificateWarning){
    line("Certificate verification detail: "+emergency.certificateWarning.step+" ("+emergency.certificateWarning.errorClass+")");
    line("The certificate page was not verified. No certificate claim is made.");
  }else if(!emergency.ok){
    line("Failure step: "+(emergency.step||"UNKNOWN")+" ("+(emergency.errorClass||"Error")+")");
  }
  line("No envelope, signer, field, signature, audit-chain, hash, certificate, archive or storage record was written or changed.");
  const bytes=new Uint8Array(await pdf.save({useObjectStreams:false}));
  return {bytes,hash:await sha256Hex(bytes)};
}

export function createSignatureRecoveryRouter({authenticateFirebaseRequest,getFirestoreDocument,buildContext,json,corsHeaders}={}) {
  return async function signatureRecoveryRouter(request,env,pathname) {
    if(!pathname.startsWith("/api/recovery/envelopes"))return null;
    const emergencyPath=pathname.match(/^\/api\/recovery\/envelopes\/([A-Za-z0-9_-]{3,64})\/emergency-retrieval$/);
    if(emergencyPath&&request.method!=="POST")return json({ok:false,error:"Emergency retrieval requires POST."},405,corsHeaders(request));
    if(!emergencyPath&&request.method!=="GET")return json({ok:false,error:"Recovery evidence endpoints are read-only GET operations."},405,corsHeaders(request));
    let claims;
    try { claims=await authenticateFirebaseRequest(request,env); }
    catch { return json({ok:false,error:"A valid IRPA sign-in is required."},401,corsHeaders(request)); }
    const uid=String(claims?.user_id||"").trim();
    if(!uid)return json({ok:false,error:"A valid IRPA sign-in is required."},401,corsHeaders(request));
    const profile=await getFirestoreDocument(env,"adminProfiles/"+uid,claims.token).catch(()=>null);
    const isAdmin=claims.admin===true||String(claims.email||"").trim().toLowerCase()==="irpa2412@gmail.com"||profile?.fields?.active?.booleanValue===true;
    const user={uid,isAdmin};
    const ctx=buildContext(env,claims,user);
    try {
      if(emergencyPath){
        const result=await buildEmergencyRetrieval(ctx,user,decodeURIComponent(emergencyPath[1]));
        if(!result.ok)return json({ok:false,code:result.code||"EMERGENCY_RETRIEVAL_FAILED:UNKNOWN",step:result.step||"UNKNOWN",errorClass:result.errorClass||"Error",messageEn:result.messages?.[0]||emergencyStepMessages.UNKNOWN[0],messageSw:result.messages?.[1]||emergencyStepMessages.UNKNOWN[1],stages:result.stages},result.status||500,corsHeaders(request));
        return new Response(result.bytes,{status:200,headers:{...corsHeaders(request),"content-type":"application/pdf",'content-disposition':'attachment; filename="UNARCHIVED-COPY-CERTIFICATE-NOT-VERIFIED.pdf"',"cache-control":"no-store, private","pragma":"no-cache","x-content-type-options":"nosniff","x-irpa-copy-label":result.label,"x-irpa-output-sha256":result.outputHash,"x-irpa-stage-log":JSON.stringify(result.stages),"x-irpa-copy-warning":result.certificateWarning?result.label:"","x-irpa-copy-checks":JSON.stringify(result.checks),"x-irpa-environments":JSON.stringify({envelope:result.envelopeEnvironment,preservedCopy:result.preservedEnvironment,worker:result.workerEnvironment})}});
      }
      const evidencePdf=pathname.match(/^\/api\/recovery\/envelopes\/([A-Za-z0-9_-]{3,64})\/emergency-evidence-report\.pdf$/);
      if(evidencePdf){
        const report=await buildEmergencyEvidenceReportPdf(ctx,user,decodeURIComponent(evidencePdf[1]));
        return new Response(report.bytes,{status:200,headers:{...corsHeaders(request),"content-type":"application/pdf","content-disposition":'attachment; filename="emergency-retrieval-evidence-report.pdf"',"cache-control":"no-store, private","pragma":"no-cache","x-content-type-options":"nosniff","x-irpa-report-sha256":report.hash}});
      }
      if(pathname==="/api/recovery/envelopes") {
        const url=new URL(request.url);
        const limit=url.searchParams.get("limit");
        const offset=url.searchParams.get("offset");
        const result=await getRecoveryQueue(ctx,user,{limit,offset});
        return json(result,200,corsHeaders(request));
      }
      const evidence=matchRecoveryEvidenceRoute(request.method,pathname);
      if(evidence) {
        const result=await assessRecoveryEvidence(ctx,user,decodeURIComponent(evidence[1]));
        return json(result,200,corsHeaders(request));
      }
      const completedCopy=pathname.match(/^\/api\/recovery\/envelopes\/([A-Za-z0-9_-]{3,64})\/completed-copy\.pdf$/);
      if(completedCopy) {
        const copy=await buildUnarchivedCompletedCopy(ctx,user,decodeURIComponent(completedCopy[1]),buildEmergencyRetrieval);
        const eat=new Date(copy.generatedAt).toLocaleString("en-GB",{timeZone:"Africa/Dar_es_Salaam",hour12:false});
        return new Response(copy.bytes,{status:200,headers:{
          ...corsHeaders(request),
          "content-type":"application/pdf",
          "content-disposition":'attachment; filename="unarchived-completed-copy.pdf"',
          "cache-control":"no-store, private",
          "pragma":"no-cache",
          "x-content-type-options":"nosniff",
          "x-irpa-copy-status":"UNARCHIVED_NOT_COMPLETED",
          "x-irpa-generated-at-eat":eat,
          "x-irpa-document-sha256":copy.hash,
          "x-irpa-recorded-hash-comparison":copy.comparison,
          "x-irpa-copy-source":copy.source,
          "x-irpa-fallback-code":copy.fallbackCode||"",
          "x-irpa-copy-label":"Unarchived copy; the envelope is not yet Completed",
          "x-irpa-copy-disclaimer":"Unarchived copy generated "+eat+" EAT; SHA-256 "+copy.hash+"; the envelope is not yet Completed"
        }});
      }
      const preview=pathname.match(/^\/api\/recovery\/envelopes\/([A-Za-z0-9_-]{1,128})\/preview\.pdf$/);
      if(preview) {
        const result=await buildRecoveryPreview(ctx,user,decodeURIComponent(preview[1]));
        return new Response(result.bytes,{status:200,headers:{...corsHeaders(request),"content-type":"application/pdf","cache-control":"no-store","content-disposition":"inline; filename=\\\"recovery-preview.pdf\\\""}});
      }
      return json({ok:false,error:"Not found."},404,corsHeaders(request));
    } catch(error) {
      const status=Number(error?.status)||500;
      const message=String(error?.message||"EMERGENCY_RETRIEVAL_REQUEST_FAILED");
      return json({ok:false,error:message,stages:[{stageCode:"REQUEST",status:"fail",error:message}]},status,corsHeaders(request));
    }
  };
}
