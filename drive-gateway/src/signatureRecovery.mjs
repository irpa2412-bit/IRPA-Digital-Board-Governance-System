import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { canonicalJson, sha256Hex, HttpError } from "./util.mjs";
import { resendInvitation } from "./signing.mjs";
import { cleanText, randomHex, validateEmail, validateName } from "./util.mjs";
import { matchRecoveryEvidenceRoute } from "./esignPathPolicy.mjs";
import { buildUnarchivedCompletedCopy } from "./courtRecoveryCopy.mjs";

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
export async function assessRecoveryEvidence(ctx,user,id){
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
  const stageRecordIntegrityValid=finalisationStages.length>0&&finalisationStages.every(entry=>entry.stageCodeValid&&entry.status!=="INVALID"&&entry.recordedAt!==null)&&
    (latestStage===null||allowedFinalisationStages.has(latestStage))&&
    (firstFailedStage===null||(allowedFinalisationStages.has(firstFailedStage)&&storedStageMap[firstFailedStage]?.status==="FAILED"));
  const stageRecordIntegrity={status:!hasFinalisationRecord?"NOT_PRESENT":stageRecordIntegrityValid?"CONSISTENT":"INCONSISTENT",entryCount:finalisationStages.length};
  const pendingRecord=envelope.completion?.archivePending&&typeof envelope.completion.archivePending==="object"?envelope.completion.archivePending:null;
  const pendingHash=String(pendingRecord?.finalHash||"").trim().toLowerCase();
  const pendingFileName=String(pendingRecord?.fileName||"").split(/[\\\/]/).pop().slice(0,120)||null;
  const archivePending={metadataPresent:Boolean(pendingRecord),storageReferencePresent:Boolean(pendingRecord?.storageId),recordedHashPresent:/^[a-f0-9]{64}$/.test(pendingHash),recordedHash:/^[a-f0-9]{64}$/.test(pendingHash)?pendingHash:null,fileName:pendingFileName,createdAt:typeof pendingRecord?.createdAt==="string"?pendingRecord.createdAt:null,environment:pendingRecord?.environment?String(pendingRecord.environment).toUpperCase():null,artifactBytesVerified:false};
  if(auditChainStatus==="VERIFIED"){try{await appendRecoveryAccessEvent(ctx,user,id,"recovery.evidence.assessed",{verifiedStampCount:rows.filter(x=>x.status==="VERIFIED_EXISTING").length,nonVerifiedStampCount:rows.filter(x=>x.status!=="PASS").length});}catch{}}
  return {ok:true,envelopeId:id,title:envelope.title||"",status:envelope.status,auditChain:{status:auditChainStatus,code:auditChainStatus==="VERIFIED"?"AUDIT_CHAIN_VERIFIED":auditChainStatus==="FAILED"?"AUDIT_CHAIN_FAILED":"AUDIT_CHAIN_NO_EVENTS"},auditChainValid:auditChainStatus==="VERIFIED",sourceHash,sourceHashStatus,sourceHashCode,sourceHashReason,finalisationStage,finalisationStageCode:rawStage||"FINALISATION_STAGE_NOT_RECORDED",completionFailure:{stage:envelope.completionFailure?.stage||null,failedAt:envelope.completionFailure?.failedAt||null},finalisationRecord:{latestStage,firstFailedStage,updatedAt:typeof storedFinalisationRecord.updatedAt==="string"?storedFinalisationRecord.updatedAt:null,stages:finalisationStages},stageRecordIntegrity,archivePending,stampSlots:rows,summary:{verified:rows.filter(x=>x.resultStatus==="PASS"||x.status==="VERIFIED_EXISTING").length,missing:rows.filter(x=>x.status==="MISSING").length,failed:rows.filter(x=>x.status==="INVALID").length,unverifiable:rows.filter(x=>x.status==="UNVERIFIABLE").length}};
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


export function createSignatureRecoveryRouter({authenticateFirebaseRequest,getFirestoreDocument,buildContext,json,corsHeaders}={}) {
  return async function signatureRecoveryRouter(request,env,pathname) {
    if(!pathname.startsWith("/api/recovery/envelopes"))return null;
    if(request.method!=="GET")return json({ok:false,error:"Recovery evidence endpoints are read-only GET operations."},405,corsHeaders(request));
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
        const copy=await buildUnarchivedCompletedCopy(ctx,user,decodeURIComponent(completedCopy[1]));
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
      return json({ok:false,error:status>=400&&status<500?String(error.message||"Recovery request denied."):"Recovery assessment is temporarily unavailable."},status,corsHeaders(request));
    }
  };
}
