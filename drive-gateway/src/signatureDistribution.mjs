import {sha256Hex, validateEmail} from "./util.mjs";
import {signerCopyPath} from "./archives.mjs";

const clean = value => String(value ?? "").trim();
const safeError = (error, email) => String(error?.message || "Email delivery failed.")
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[recipient]")
  .replace(email || "\u0000", "[recipient]")
  .slice(0, 240);
const maskAddress=email=>{const [local,domain]=String(email||"").split("@");if(!local||!domain)return "";return local.slice(0,1)+"***@"+domain;};
const replyCategory=error=>["ACCEPTED","RATE_LIMITED","AUTH_FAILED","CONNECTION_REFUSED","MAILBOX_FULL","RECIPIENT_REJECTED","UNKNOWN"].includes(error?.smtpReplyCategory)?error.smtpReplyCategory:"UNKNOWN";
const stageCode=error=>["BUILD_MESSAGE","SMTP_CONNECT","SMTP_AUTH","RCPT_ACCEPTED","SUBMIT"].includes(error?.stageCode)?error.stageCode:"SUBMIT";

function recipientsFor(envelope) {
  const byEmail = new Map();
  const add = (email, name, uid, role, signerId = null) => {
    let normalized = "";
    try { normalized = validateEmail(email).trim().toLowerCase(); } catch {}
    const key = normalized || ("missing:" + String(uid || role || signerId || "recipient"));
    const current = byEmail.get(key) || {email:normalized,name:clean(name)||"IRPA participant",uid:uid||null,roles:[],signerIds:[]};
    if (uid && !current.uid) current.uid = uid;
    if (role && !current.roles.includes(role)) current.roles.push(role);
    if (signerId && !current.signerIds.includes(signerId)) current.signerIds.push(signerId);
    byEmail.set(key,current);
  };
  add(envelope.ownerEmail || envelope.createdByEmail,envelope.ownerName,envelope.createdBy,"Document Owner");
  for (const signer of envelope.signers || []) if(signer?.status==="Signed") add(signer.email,signer.name,signer.uid,"Signer",signer.id);
  return [...byEmail.values()];
}
async function update(ctx,id,patch){const current=await ctx.meta.get("signatureDistributions",id);if(!current)return;await ctx.meta.update("signatureDistributions",id,patch,{ifVersion:current._v});}
async function updatePersonalCopy(ctx,id,patch){const current=await ctx.meta.get("signaturePersonalCopies",id);if(!current)return;await ctx.meta.update("signaturePersonalCopies",id,patch,{ifVersion:current._v});}
const safePersonalCopyError=error=>String(error?.message||"Personal copy write failed.").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[recipient]").replace(/Bearer\s+\S+/gi,"Bearer [REDACTED]").slice(0,240);
async function persistEnvelopeDistribution(ctx,envelopeId,summary){
  const current=await ctx.meta.get("envelopes",envelopeId);if(!current)return;
  await ctx.meta.update("envelopes",envelopeId,{distributionStatus:summary.status,distribution:{status:summary.status,total:summary.total,sent:summary.sent,failed:summary.failed,updatedAt:ctx.now().toISOString()}},{ifVersion:current._v});
}
export async function getSignatureDistributionSummary(ctx,envelopeId){
  const rows=(await ctx.meta.list("signatureDistributions")).filter(row=>row.envelopeId===envelopeId);
  const counts={total:rows.length,sent:0,failed:0,pending:0,sending:0,unknown:0};
  for(const row of rows){if(row.status==="Sent")counts.sent++;else if(row.status==="Failed")counts.failed++;else if(row.status==="Sending")counts.sending++;else if(row.status==="Unknown")counts.unknown++;else counts.pending++;}
  const status=counts.total===0?"NotStarted":counts.sent===counts.total?"Sent":counts.failed>0&&counts.sent>0?"PartiallyFailed":counts.failed===counts.total?"Failed":"NotStarted";
  return{...counts,status,complete:counts.total>0&&counts.sent===counts.total,deliveries:rows.map(row=>({recipientAddress:row.maskedAddress||maskAddress(row.recipientEmail),accepted:row.acceptedByMailServer===true,status:row.status,stageCode:row.stageCode||null,replyCategory:row.replyCategory||"UNKNOWN",attempts:Number(row.attempts||0),lastError:row.lastError||null,sentAt:row.sentAt||null}))};
}

export async function distributeCompletedPersonalCopies(ctx,envelope,completion,{bytes=null,retryFailed=false}={}){
  if(envelope?.status!=="Completed"||!completion?.primaryStorageId||!completion?.finalHash)throw new Error("Only a verified completed signature envelope can create personal copies.");
  const finalBytes=bytes||await ctx.storage.get(completion.primaryStorageId);
  if(!(finalBytes instanceof Uint8Array)||!finalBytes.length||await sha256Hex(finalBytes)!==completion.finalHash)throw new Error("The authoritative completed PDF failed its integrity check; personal copies were stopped.");
  const recipients=new Map();
  const add=(uid,kind,signerId=null)=>{if(!uid)return;const key=String(uid);const item=recipients.get(key)||{uid:key,kind,signerIds:[]};if(signerId&&!item.signerIds.includes(signerId))item.signerIds.push(signerId);if(kind==="owner-copy")item.kind=kind;recipients.set(key,item);};
  add(envelope.createdBy,"owner-copy");
  for(const signer of envelope.signers||[])if(signer?.status==="Signed")add(signer.profileUid||signer.uid,"signer-copy",signer.id);
  const files=[];
  for(const recipient of recipients.values()){
    const uidHash=await sha256Hex(recipient.uid),id="personal-copy-"+envelope.id+"-"+uidHash.slice(0,32);
    let record=await ctx.meta.get("signaturePersonalCopies",id);
    if(!record){
      const created={envelopeId:envelope.id,documentId:envelope.documentId,recipientUid:recipient.uid,signerIds:recipient.signerIds,copyKind:recipient.kind,fileName:completion.fileName,finalHash:completion.finalHash,status:"Pending",attempts:0,createdAt:ctx.now().toISOString()};
      try{await ctx.meta.create("signaturePersonalCopies",id,created)}catch{record=await ctx.meta.get("signaturePersonalCopies",id);if(!record)throw new Error("Unable to create the personal-copy delivery record.");}
      record=record||await ctx.meta.get("signaturePersonalCopies",id);
    }
    if(record?.status==="Stored"){files.push({kind:recipient.kind,signerId:recipient.signerIds[0]||null,recipientUid:recipient.uid,id:record.storageId,path:record.path});continue;}
    if(record?.status==="Failed"&&!retryFailed&&Number(record.attempts||0)>0)continue;
    const attempts=Number(record?.attempts||0)+1;
    await updatePersonalCopy(ctx,id,{status:"Writing",attempts,lastAttemptAt:ctx.now().toISOString(),lastError:null});
    try{
      const path=signerCopyPath({ownerKey:recipient.uid,fileName:completion.fileName});
      const stored=await ctx.storage.put({path,bytes:finalBytes,contentType:"application/pdf",metadata:{envelopeId:envelope.id,documentId:envelope.documentId,recipientUid:recipient.uid,recipientSignerId:recipient.signerIds.join(","),copyKind:recipient.kind,finalHash:completion.finalHash,state:"Final Completed Document",archive:"my-documents"}});
      await updatePersonalCopy(ctx,id,{status:"Stored",storageId:stored.id,path,storedAt:ctx.now().toISOString(),lastError:null});
      files.push({kind:recipient.kind,signerId:recipient.signerIds[0]||null,recipientUid:recipient.uid,id:stored.id,path});
    }catch(error){
      await updatePersonalCopy(ctx,id,{status:"Failed",failedAt:ctx.now().toISOString(),lastError:safePersonalCopyError(error)});
      ctx.logger?.error?.("SIGNATURE_PERSONAL_COPY_WRITE_FAILED",{envelopeId:envelope.id,recipientUidHash:uidHash.slice(0,16),copyKind:recipient.kind,attempt:attempts,errorType:String(error?.name||"Error").slice(0,60)});
    }
  }
  const rows=(await ctx.meta.list("signaturePersonalCopies")).filter(row=>row.envelopeId===envelope.id);
  const summary={total:recipients.size,stored:rows.filter(row=>row.status==="Stored").length,failed:rows.filter(row=>row.status==="Failed").length,pending:rows.filter(row=>row.status==="Pending"||row.status==="Writing").length,skipped:(envelope.signers||[]).filter(s=>s?.status==="Signed"&&!s.profileUid&&!s.uid).length,files};
  const current=await ctx.meta.get("envelopes",envelope.id);
  if(current?.completion){
    const existing=Array.isArray(current.completion.files)?current.completion.files:[];
    const byId=new Map(existing.map(file=>[file.id,file]));
    for(const file of files)byId.set(file.id,file);
    await ctx.meta.update("envelopes",envelope.id,{completion:{...current.completion,files:[...byId.values()] }},{ifVersion:current._v});
  }
  return summary;
}

export async function distributeCompletedSignatureDocument(ctx,envelope,completion,{bytes=null,retryFailed=false}={}){
  if(envelope?.status!=="Completed"||!completion?.primaryStorageId||!completion?.finalHash)throw new Error("Only a verified completed signature envelope can be distributed.");
  const finalBytes=bytes||await ctx.storage.get(completion.primaryStorageId);
  if(!(finalBytes instanceof Uint8Array)||!finalBytes.length||await sha256Hex(finalBytes)!==completion.finalHash)throw new Error("The authoritative completed PDF failed its integrity check; distribution was stopped.");
  const recipients=recipientsFor(envelope);
  for(const recipient of recipients){
    const emailHash=recipient.email?await sha256Hex(recipient.email):await sha256Hex("missing|"+envelope.id+"|"+(recipient.uid||recipient.roles.join(",")));
    const id="delivery-"+envelope.id+"-"+emailHash.slice(0,32);
    let record=await ctx.meta.get("signatureDistributions",id);
    if(!record){
      const created={envelopeId:envelope.id,externalReference:envelope.externalReference||null,documentId:envelope.documentId,recipientUid:recipient.uid,recipientEmail:recipient.email||"",recipientEmailHash:emailHash,maskedAddress:maskAddress(recipient.email),recipientName:recipient.name,recipientRoles:recipient.roles,signerIds:recipient.signerIds,fileName:completion.fileName,finalHash:completion.finalHash,status:recipient.email?"Pending":"Failed",attempts:0,lastError:recipient.email?null:"RECIPIENT_EMAIL_MISSING",stageCode:recipient.email?null:"BUILD_MESSAGE",replyCategory:"UNKNOWN",acceptedByMailServer:false,createdAt:ctx.now().toISOString()};
      try{await ctx.meta.create("signatureDistributions",id,created);}catch{record=await ctx.meta.get("signatureDistributions",id);if(!record)throw new Error("Unable to create the recipient distribution record.");}
      record=record||await ctx.meta.get("signatureDistributions",id);
    }
    if(!record||record.status==="Sent"||record.status==="Unknown"||record.status==="Sending")continue;
    if(record.status==="Failed"&&!retryFailed&&Number(record.attempts||0)>0)continue;
    if(!recipient.email)continue;
    if(typeof ctx.sendCompletionEmail!=="function"){await update(ctx,id,{status:"Failed",acceptedByMailServer:false,stageCode:"SMTP_CONNECT",replyCategory:"UNKNOWN",lastError:"EMAIL_TRANSPORT_NOT_CONFIGURED",lastAttemptAt:ctx.now().toISOString()});continue;}
    const attempts=Number(record.attempts||0)+1;
    await update(ctx,id,{status:"Sending",attempts,lastAttemptAt:ctx.now().toISOString(),lastError:null});
    try{
      const result=await ctx.sendCompletionEmail({to:recipient.email,name:recipient.name,recipientRoles:recipient.roles,title:envelope.title||completion.fileName,fileName:completion.fileName,completedAt:completion.completedAt,finalHash:completion.finalHash,bytes:finalBytes});
      await update(ctx,id,{status:"Sent",acceptedByMailServer:true,stageCode:null,replyCategory:"ACCEPTED",sentAt:ctx.now().toISOString(),messageId:clean(result?.messageId||result||"").slice(0,180),lastError:null});
    }catch(error){
      await update(ctx,id,{status:error?.deliveryOutcome==="unknown"?"Unknown":"Failed",acceptedByMailServer:false,stageCode:stageCode(error),replyCategory:replyCategory(error),failedAt:ctx.now().toISOString(),lastError:safeError(error,recipient.email)});
      ctx.logger?.error?.("SIGNATURE_COMPLETION_EMAIL_FAILED",{envelopeId:envelope.id,recipientDomain:recipient.email.split("@")[1]||"unknown",status:error?.deliveryOutcome==="unknown"?"Unknown":"Failed",stageCode:stageCode(error),replyCategory:replyCategory(error),attempt:attempts});
    }
  }
  const summary=await getSignatureDistributionSummary(ctx,envelope.id);
  await persistEnvelopeDistribution(ctx,envelope.id,summary);
  return summary;
}
export async function retryFailedSignatureDistributions(ctx,user,envelopeId){
  const envelope=await ctx.meta.get("envelopes",envelopeId);
  if(!envelope||(envelope.createdBy!==user?.uid&&user?.isAdmin!==true)){const error=new Error("Not authorized.");error.status=403;throw error;}
  if(envelope.status!=="Completed"||!envelope.completion){const error=new Error("Only completed documents can be redistributed.");error.status=409;throw error;}
  const summary=await distributeCompletedSignatureDocument(ctx,envelope,envelope.completion,{retryFailed:true});
  const personalCopies=await distributeCompletedPersonalCopies(ctx,envelope,envelope.completion,{retryFailed:true});
  return{ok:true,envelopeId,distribution:summary,personalCopies};
}
