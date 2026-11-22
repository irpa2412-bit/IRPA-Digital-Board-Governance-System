import {buildSignedPdf} from "./pdf.mjs";
import {createCryptographicEvidence} from "./cryptographicGate.mjs";
import {archivePath} from "./archives.mjs";
import {HttpError,sha256Hex} from "./util.mjs";
const safeCode=value=>String(value?.code||value?.name||"DIAGNOSTIC_FAILED").replace(/[^A-Z0-9_-]/gi,"").slice(0,48)||"DIAGNOSTIC_FAILED";
const safeMessage=value=>String(value?.message||"Diagnostic step failed.").replace(/Bearer\s+\S+/gi,"Bearer [REDACTED]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[REDACTED EMAIL]").replace(/https?:\/\/\S+/gi,"[URL REDACTED]").slice(0,180);
const fail=(stage,error,fields=[])=>({stageCode:stage,status:"FAILED",errorCode:safeCode(error),message:safeMessage(error),fields});
const pass=(stage,details={},fields=[])=>({stageCode:stage,status:"PASS",errorCode:null,message:null,...details,fields});
const fieldsFor=envelope=>(Array.isArray(envelope?.fields)?envelope.fields:[]).filter(field=>[1,3].includes(Number(field?.page))).map(field=>({page:Number(field.page),fieldId:String(field.fieldId||"UNKNOWN_FIELD").slice(0,100),type:String(field.type||"Unknown"),rotation:Number(field.rotation||0),position:{x:Number(field.x),y:Number(field.y),width:Number(field.width),height:Number(field.height)}}));
const error=(message,code)=>Object.assign(new Error(message),{code});
async function buildEvidence(envelope,bytes,ctx){
 const provider=ctx.crypto?.keyProvider,required=["staging","production"].includes(ctx.env?.IRPA_ENVIRONMENT)||(ctx.env?.DRIVE_MOCK==="false"&&ctx.allowReturnTokens!==true);
 if(!provider){if(required)throw error("Cryptographic signer key custody is not configured.","CERTIFICATE_KEY_PROVIDER_MISSING");return{count:0,required:false};}
 const documentHash=await sha256Hex(bytes),chainHead=envelope.events?.at(-1)?.hash;
 if(!/^[0-9a-f]{64}$/.test(String(chainHead||"")))throw error("The audit-chain head is unavailable for certificate verification.","CERTIFICATE_CHAIN_HEAD_MISSING");
 let count=0;
 for(const signer of envelope.signers||[]){
  const key=signer.uid?await provider.getSignerKey(signer.uid):await provider.getSignerKeyForSignerReadOnly?.({...signer,envelopeId:envelope.id});
  if(!key)throw error("Signer cryptographic key custody is unavailable.","CERTIFICATE_SIGNER_KEY_MISSING");
  await createCryptographicEvidence({keyId:key.keyId,signer:{uid:signer.uid||null,identityType:signer.identityType||"account",emailHash:signer.emailHash||null,signerId:signer.id,envelopeId:envelope.id,signatureHash:await sha256Hex(String(signer.signatureValue||"")),signatureType:signer.signatureType,authorityVerification:signer.authorityVerification||null,privateKey:key.privateKey,publicKey:key.publicKey,signCanonicalPayload:key.signCanonicalPayload},publicKeyJwk:key.publicKeyJwk,documentHash,chainHead,signedAt:signer.signedAt});
  count++;
 }
 return{count,required};
}
export async function diagnoseFinalisation(ctx,user,envelopeId){
 const envelope=await ctx.meta.get("envelopes",envelopeId);
 if(!envelope)throw new HttpError(404,"Envelope not found.");
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
 if(finalBytes&&finalHash){try{const evidence=await buildEvidence(envelope,finalBytes,ctx);report.steps.push(pass("CERTIFICATE",{cryptographicEvidenceChecked:evidence.count,cryptographicEvidenceRequired:evidence.required,completionCertificatePageBuilt:true},fields));}catch(cause){report.steps.push(fail("CERTIFICATE",cause,fields));}}
 else report.steps.push(fail("CERTIFICATE",error("Certificate check requires a successful PDF build and hash.","PDF_BUILD_FAILED"),fields));
 try{
  const targets=Array.isArray(envelope.archiveTargets)?envelope.archiveTargets:[];
  if(!targets.length)throw error("No archive targets are configured.","ARCHIVE_TARGETS_MISSING");
  if(typeof ctx.storage.probeWritePermission!=="function")throw error("Storage provider does not expose a non-writing archive permission probe.","ARCHIVE_PERMISSION_PROBE_UNAVAILABLE");
  const paths=targets.map(key=>archivePath({archiveKey:key,classification:envelope.classification,documentId:envelope.documentId,fileName:"diagnostic-no-write.pdf"}));
  const result=await ctx.storage.probeWritePermission(paths);
  if(result===false||(Array.isArray(result)&&result.some(value=>value!==true)))throw error("Archive write permission probe denied at least one destination.","ARCHIVE_PERMISSION_DENIED");
  report.steps.push(pass("ARCHIVE",{permission:"CONFIRMED_WITHOUT_WRITE",targets:paths.length},fields));
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
