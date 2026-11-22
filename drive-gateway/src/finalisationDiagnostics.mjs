import {buildSignedPdf} from "./pdf.mjs";
import {archivePath,signerCopyPath} from "./archives.mjs";
import {HttpError,sha256Hex} from "./util.mjs";
const safeCode=value=>String(value?.code||value?.name||"DIAGNOSTIC_FAILED").replace(/[^A-Z0-9_-]/gi,"").slice(0,48)||"DIAGNOSTIC_FAILED";
const safeMessage=value=>String(value?.message||"Diagnostic step failed.").replace(/Bearer\s+\S+/gi,"Bearer [REDACTED]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[REDACTED EMAIL]").replace(/https?:\/\/\S+/gi,"[URL REDACTED]").slice(0,180);
const fail=(stage,error,fields=[])=>({stageCode:stage,status:"FAILED",errorCode:safeCode(error),message:safeMessage(error),fields});
const pass=(stage,details={},fields=[])=>({stageCode:stage,status:"PASS",errorCode:null,message:null,...details,fields});
const fieldsFor=envelope=>(Array.isArray(envelope?.fields)?envelope.fields:[]).filter(field=>[1,3].includes(Number(field?.page))).map(field=>({page:Number(field.page),fieldId:String(field.fieldId||"UNKNOWN_FIELD").slice(0,100),type:String(field.type||"Unknown"),rotation:Number(field.rotation||0),position:{x:Number(field.x),y:Number(field.y),width:Number(field.width),height:Number(field.height)}}));
const error=(message,code)=>Object.assign(new Error(message),{code});
async function inspectCertificateKeys(envelope,ctx){
 const provider=ctx.crypto?.keyProvider,required=["staging","production"].includes(ctx.env?.IRPA_ENVIRONMENT)||(ctx.env?.DRIVE_MOCK==="false"&&ctx.allowReturnTokens!==true);
 const signers=Array.isArray(envelope.signers)?envelope.signers:[];
 if(!provider){
  if(required)throw error("Cryptographic signer key custody is not configured.","CERTIFICATE_KEY_PROVIDER_MISSING");
  return{required:false,signerKeyChecks:signers.map(signer=>({signerId:String(signer.id||"UNKNOWN"),signerKey:"MISSING",errorCode:"CERTIFICATE_KEY_PROVIDER_MISSING"}))};
 }
 const signerKeyChecks=[];
 for(const signer of signers){
  try{
   const key=signer.uid?await provider.getSignerKey(signer.uid):await provider.getSignerKeyForSignerReadOnly?.({...signer,envelopeId:envelope.id});
   signerKeyChecks.push({signerId:String(signer.id||"UNKNOWN"),signerKey:key?.publicKey||key?.publicKeyJwk?"PRESENT":"MISSING",keyId:key?.keyId||null,errorCode:key?null:"CERTIFICATE_SIGNER_KEY_MISSING"});
  }catch(cause){
   signerKeyChecks.push({signerId:String(signer.id||"UNKNOWN"),signerKey:"MISSING",keyId:null,errorCode:safeCode(cause)});
  }
 }
 return{required,signerKeyChecks};
}
export async function diagnoseFinalisation(ctx,user,envelopeId){
 const envelope=await ctx.meta.get("envelopes",envelopeId);
 if(!envelope)throw new HttpError(404,"Envelope not found.");
 const runtimeEnvironment=String(ctx.env?.IRPA_ENVIRONMENT||"").trim().toLowerCase();
 const runtimeDataEnvironment=runtimeEnvironment==="staging"?"TRIAL":runtimeEnvironment==="production"?"ACTUAL":runtimeEnvironment==="trial"?"TRIAL":runtimeEnvironment==="actual"?"ACTUAL":runtimeEnvironment==="test"?"TEST":null;
 const dataEnvironment=String(envelope.dataEnvironment||"").trim().toUpperCase();
 if(!runtimeDataEnvironment||runtimeDataEnvironment!==dataEnvironment||!["TRIAL","ACTUAL","TEST"].includes(dataEnvironment))throw new HttpError(409,"Finalisation diagnostics are blocked because the recorded envelope data environment is invalid for this Gateway.");
 if(!user?.uid)throw new HttpError(401,"Authentication required.");
 const isEnvelopeOwner=[envelope.createdBy,envelope.createdByUid,envelope.ownerUid].includes(user.uid);
 if(!isEnvelopeOwner&&user?.isAdmin!==true&&user?.isOwner!==true)throw new HttpError(403,"Not authorized.");
 if(!["CompletionFailed","Completing","Completed"].includes(envelope.status))throw new HttpError(409,"Only a completed or failed-completion envelope can be diagnosed.");
 const fields=fieldsFor(envelope),report={schema:"IRPA-FINALISATION-DIAGNOSTIC-1",envelopeId:String(envelope.id),status:envelope.status,readOnly:true,generatedAt:ctx.now().toISOString(),timezone:"East Africa Time (UTC+3)",steps:[],fieldChecks:[],summary:{passed:0,failed:0,firstFailedStage:null}};
 report.fieldChecks=fields.map(field=>({...field,status:["Signature","Initials","Date","Name","Title","Text","Number","Comment","Remarks","Checkbox"].includes(field.type)&&[0,90,180,270].includes(field.rotation)&&Object.values(field.position).every(Number.isFinite)?"PASS":"FAILED",errorCode:null,message:null}));
 let finalBytes=null,finalHash=null;
 try{
  const document=await ctx.meta.get("documents",envelope.documentId),originalBytes=document?.primaryStorageId?await ctx.storage.get(document.primaryStorageId):null;
  if(!(originalBytes instanceof Uint8Array)||!originalBytes.length)throw error("The original PDF is unavailable.","SOURCE_PDF_UNAVAILABLE");
  const expectedHash=String(envelope.documentHash||document.sha256||document.hash||"").toLowerCase();
  if(expectedHash&&await sha256Hex(originalBytes)!==expectedHash)throw error("The source PDF hash does not match its recorded value.","SOURCE_HASH_MISMATCH");
  finalBytes=await buildSignedPdf(originalBytes,{envelopeId:envelope.id,documentId:envelope.documentId,title:envelope.title,originalHash:envelope.documentHash,chainHead:envelope.events?.at(-1)?.hash||"GENESIS",events:envelope.events||[],completedAt:ctx.now().toISOString(),signers:(envelope.signers||[]).map(s=>({id:s.id,uid:s.uid,name:s.name,email:s.email,signedAt:s.signedAt,ip:s.ip,signatureType:s.signatureType,signatureValue:s.signatureValue,fieldValues:s.fieldValues||{},signerDeclarations:s.signerDeclarations||{},declarationDiscrepancy:s.declarationDiscrepancy||null})),fields:envelope.fields||[]});
  report.steps.push(pass("PDF_BUILD",{byteLength:finalBytes.byteLength,stampingPages:[1,3],timestampTimezone:"EAT"},fields));
 }catch(cause){report.steps.push(fail("PDF_BUILD",cause,fields));}
 if(finalBytes){try{finalHash=await sha256Hex(finalBytes);report.steps.push(pass("HASH",{byteLength:finalBytes.byteLength,sha256:finalHash},fields));}catch(cause){report.steps.push(fail("HASH",cause,fields));}}
 else report.steps.push(fail("HASH",error("PDF build did not produce bytes.","PDF_BUILD_FAILED")));
 if(finalBytes&&finalHash){try{const certificate=await inspectCertificateKeys(envelope,ctx),missing=certificate.signerKeyChecks.filter(check=>check.signerKey!=="PRESENT");report.steps.push({...pass("CERTIFICATE",{readOnly:true,signingPerformed:false,cryptographicEvidenceCreated:false,cryptographicEvidenceRequired:certificate.required,signerKeyChecks:certificate.signerKeyChecks,signerKeyPresent:certificate.signerKeyChecks.length-missing.length,signerKeyMissing:missing.length},fields),status:missing.length?"FAILED":"PASS",errorCode:missing.length?"CERTIFICATE_SIGNER_KEY_MISSING":null,message:missing.length?"One or more signer keys are missing.":null});}catch(cause){report.steps.push(fail("CERTIFICATE",cause,fields));}}
 else report.steps.push(fail("CERTIFICATE",error("Certificate key check requires a successful PDF build and hash.","PDF_BUILD_FAILED"),fields));
 try{
  const targets=Array.isArray(envelope.archiveTargets)?envelope.archiveTargets:[];
  if(!targets.length)throw error("No archive targets are configured.","ARCHIVE_TARGETS_MISSING");
  const fileName=envelope.fileName||"diagnostic-no-write.pdf";
  const destinations=targets.map(archiveKey=>({name:archiveKey,destinationType:"archive",archiveKey,path:archivePath({archiveKey,classification:envelope.classification,documentId:envelope.documentId,fileName})}));
  const ownerKey=String(envelope.createdBy||envelope.createdByUid||envelope.ownerUid||"");
  if(ownerKey)destinations.push({name:"Owner copy",destinationType:"owner-copy",path:signerCopyPath({ownerKey,fileName})});
  for(const signer of envelope.signers||[]){
   const signerKey=String(signer.profileUid||signer.uid||`${envelope.id}-${signer.id}`);
   destinations.push({name:"Signer copy "+String(signer.id||"UNKNOWN"),destinationType:"signer-copy",path:signerCopyPath({ownerKey:signerKey,fileName})});
  }
  if(typeof ctx.storage.probeWritePermissionDetailed==="function"){
   const detail=await ctx.storage.probeWritePermissionDetailed(destinations);
   const denied=(detail.destinations||[]).some(destination=>destination.probe!=="PASS");
   report.steps.push({...pass("ARCHIVE",{permission:denied?"DENIED":"CONFIRMED_WITHOUT_WRITE",tokenRefreshResult:detail.tokenRefreshResult,oauthScopes:detail.oauthScopes,quota:detail.quota,destinations:detail.destinations||[]},fields),status:denied?"FAILED":"PASS",errorCode:denied?"ARCHIVE_PERMISSION_DENIED":null,message:denied?"One or more archive or recipient-copy destinations failed the read-only Drive probe.":null});
  }else{
   if(typeof ctx.storage.probeWritePermission!=="function")throw error("Storage provider does not expose a non-writing archive permission probe.","ARCHIVE_PERMISSION_PROBE_UNAVAILABLE");
   const result=await ctx.storage.probeWritePermission(destinations.map(destination=>destination.path));
   if(result===false||(Array.isArray(result)&&result.some(value=>value!==true)))throw error("Archive write permission probe denied at least one destination.","ARCHIVE_PERMISSION_DENIED");
   report.steps.push(pass("ARCHIVE",{permission:"CONFIRMED_WITHOUT_WRITE",destinations:destinations.map(destination=>({...destination,probe:"PASS",httpStatus:null,reasonCode:null,folderIdMasked:null,matchedByName:null,creator:"NOT_RETRIEVED"}))},fields));
  }
 }catch(cause){report.steps.push(fail("ARCHIVE",cause,fields));}
 try{
  const recipients=[envelope.ownerEmail||envelope.createdByEmail,...(envelope.signers||[]).filter(s=>s.status==="Signed").map(s=>s.email)].filter(Boolean);
  if(!recipients.length)throw error("No completion-email recipients are available.","DISTRIBUTION_RECIPIENTS_MISSING");
  if(typeof ctx.sendCompletionEmail!=="function")throw error("Completion-email transport is not configured.","DISTRIBUTION_TRANSPORT_UNAVAILABLE");
  report.steps.push(pass("DISTRIBUTION",{recipients:recipients.length,emailsSent:0,delivery:"NOT_SENT_DRY_RUN"},fields));
 }catch(cause){report.steps.push(fail("DISTRIBUTION",cause,fields));}
 report.summary.passed=report.steps.filter(step=>step.status==="PASS").length;
 report.summary.failed=report.steps.filter(step=>step.status==="FAILED").length;
 report.summary.firstFailedStage=report.steps.find(step=>step.status==="FAILED")?.stageCode||null;
 return report;
}
