import {sha256Hex, validateEmail} from "./util.mjs";
import {signerCopyPath} from "./archives.mjs";
import {sendWithRetry} from "./invitationEmail.mjs";

const clean = value => String(value ?? "").trim();
const safeError = (error, email) => String(error?.message || "Email delivery failed.")
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[recipient]")
  .replace(email || "\u0000", "[recipient]")
  .slice(0, 240);
const maskAddress=email=>{const [local,domain]=String(email||"").split("@");if(!local||!domain)return "";return local.slice(0,1)+"***@"+domain;};
const replyCategory=error=>["ACCEPTED","RATE_LIMITED","AUTH_FAILED","CONNECTION_REFUSED","MAILBOX_FULL","RECIPIENT_REJECTED","UNKNOWN"].includes(error?.smtpReplyCategory)?error.smtpReplyCategory:"UNKNOWN";
const stageCode=error=>["BUILD_MESSAGE","SMTP_CONNECT","SMTP_AUTH","RCPT_ACCEPTED","SUBMIT"].includes(error?.stageCode)?error.stageCode:"SUBMIT";
const isRevokedSigner=signer=>signer?.invitation==="Revoked"||signer?.emailLinkStatus==="revoked"||String(signer?.status||"").toLowerCase()==="revoked";

function recipientsFor(envelope) {
  const recipients = [];
  const add = (email, name, uid, role, recipientKey, signerId = null) => {
    let normalized = "";
    try { normalized = validateEmail(email).trim().toLowerCase(); } catch {}
    recipients.push({
      recipientKey,
      email: normalized,
      name: clean(name) || "IRPA participant",
      uid: uid || null,
      roles: [role],
      signerIds: signerId ? [signerId] : []
    });
  };
  const ownerUid = envelope.createdBy || envelope.createdByUid || envelope.ownerUid || null;
  add(
    envelope.ownerEmail || envelope.createdByEmail,
    envelope.ownerName,
    ownerUid,
    "Document Owner",
    "owner:" + String(ownerUid || envelope.id || "document-owner")
  );
  (envelope.signers || []).forEach((signer, index) => {
    if (!signer || isRevokedSigner(signer)) return;
    const signerId = clean(signer.id) || "position-" + String(index + 1);
    add(
      signer.email || signer.recipientEmail || signer.emailAddress,
      signer.name,
      signer.profileUid || signer.uid,
      "Signer",
      "signer:" + signerId,
      signerId
    );
  });
  return recipients;
}
function shouldRetryCompletionEmail(error) {
  if (error?.deliveryOutcome === "unknown" || error?.retryable === false) return false;
  const stage = stageCode(error);
  const category = replyCategory(error);
  if (["AUTH_FAILED", "RECIPIENT_REJECTED", "MAILBOX_FULL"].includes(category)) return false;
  if (stage === "SUBMIT") return category === "RATE_LIMITED";
  if (stage === "BUILD_MESSAGE") return false;
  return ["SMTP_CONNECT", "SMTP_AUTH", "RCPT_ACCEPTED"].includes(stage)
    && ["UNKNOWN", "CONNECTION_REFUSED", "RATE_LIMITED"].includes(category);
}
async function update(ctx,id,patch){const current=await ctx.meta.get("signatureDistributions",id);if(!current)return;await ctx.meta.update("signatureDistributions",id,patch,{ifVersion:current._v});}
async function updatePersonalCopy(ctx,id,patch){const current=await ctx.meta.get("signaturePersonalCopies",id);if(!current)return;await ctx.meta.update("signaturePersonalCopies",id,patch,{ifVersion:current._v});}
const safePersonalCopyError=error=>String(error?.message||"Personal copy write failed.").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[recipient]").replace(/Bearer\s+\S+/gi,"Bearer [REDACTED]").slice(0,240);
async function persistEnvelopeDistribution(ctx,envelopeId,summary){
  const current=await ctx.meta.get("envelopes",envelopeId);if(!current)return;
  await ctx.meta.update("envelopes",envelopeId,{distributionStatus:summary.status,distribution:{status:summary.status,total:summary.total,sent:summary.sent,failed:summary.failed,updatedAt:ctx.now().toISOString()}},{ifVersion:current._v});
}
export async function getSignatureDistributionSummary(ctx,envelopeId,envelope=null){
  const rows=(await ctx.meta.list("signatureDistributions")).filter(row=>row.envelopeId===envelopeId);
  const counts={total:rows.length,sent:0,failed:0,pending:0,sending:0,unknown:0};
  for(const row of rows){if(row.status==="Sent")counts.sent++;else if(row.status==="Failed")counts.failed++;else if(row.status==="Sending")counts.sending++;else if(row.status==="Unknown")counts.unknown++;else counts.pending++;}
  const status=counts.total===0?"NotStarted":counts.sent===counts.total?"Sent":counts.failed>0&&counts.sent>0?"PartiallyFailed":counts.failed===counts.total?"Failed":"NotStarted";
  const matched=new Set();
  const deliveries=(envelope?recipientsFor(envelope):[]).map(recipient=>{
    let index=rows.findIndex((row,i)=>!matched.has(i)&&row.recipientKey===recipient.recipientKey);
    // Older releases keyed one delivery by email. Claim one legacy row for the
    // first matching participant only; later signer positions remain independent.
    if(index<0)index=rows.findIndex((row,i)=>!matched.has(i)&&!row.recipientKey&&(
      recipient.email?clean(row.recipientEmail).toLowerCase()===recipient.email:
      !clean(row.recipientEmail)&&recipient.uid&&row.recipientUid===recipient.uid
    ));
    const row=index>=0?rows[index]:null;
    if(index>=0)matched.add(index);
    const skipped=!recipient.email;
    return{recipientKey:recipient.recipientKey,signerIds:recipient.signerIds,recipientAddress:maskAddress(recipient.email)||recipient.name||"Recipient",recipientRoles:recipient.roles,accepted:row?.acceptedByMailServer===true,status:skipped?"Skipped":row?.status||"Not Attempted",stageCode:row?.stageCode||(skipped?"RECIPIENT_EMAIL_MISSING":null),replyCategory:row?.replyCategory||"UNKNOWN",attempts:Number(row?.attempts||0),lastError:row?.lastError||null,lastAttemptAt:row?.lastAttemptAt||null,sentAt:row?.sentAt||null};
  });
  rows.forEach((row,index)=>{if(!matched.has(index))deliveries.push({recipientAddress:row.maskedAddress||maskAddress(row.recipientEmail)||"Recipient",recipientRoles:row.recipientRoles||[],accepted:row.acceptedByMailServer===true,status:row.status,stageCode:row.stageCode||null,replyCategory:row.replyCategory||"UNKNOWN",attempts:Number(row.attempts||0),lastError:row.lastError||null,lastAttemptAt:row.lastAttemptAt||null,sentAt:row.sentAt||null});});
  return{...counts,status,complete:counts.total>0&&counts.sent===counts.total,deliveries};
}

export async function distributeCompletedPersonalCopies(ctx,envelope,completion,{bytes=null,retryFailed=false}={}){
  if(envelope?.status!=="Completed"||!completion?.primaryStorageId||!completion?.finalHash)throw new Error("Only a verified completed signature envelope can create personal copies.");
  const finalBytes=bytes||await ctx.storage.get(completion.primaryStorageId);
  if(!(finalBytes instanceof Uint8Array)||!finalBytes.length||await sha256Hex(finalBytes)!==completion.finalHash)throw new Error("The authoritative completed PDF failed its integrity check; personal copies were stopped.");
  const recipients=new Map();
  const add=(uid,kind,signerId=null)=>{if(!uid)return;const key=String(uid);const item=recipients.get(key)||{uid:key,kind,signerIds:[]};if(signerId&&!item.signerIds.includes(signerId))item.signerIds.push(signerId);if(kind==="owner-copy")item.kind=kind;recipients.set(key,item);};
  add(envelope.createdBy,"owner-copy");
  for(const signer of envelope.signers||[])if(!isRevokedSigner(signer))add(signer.profileUid||signer.uid,"signer-copy",signer.id);
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
  const summary={total:recipients.size,stored:rows.filter(row=>row.status==="Stored").length,failed:rows.filter(row=>row.status==="Failed").length,pending:rows.filter(row=>row.status==="Pending"||row.status==="Writing").length,skipped:(envelope.signers||[]).filter(s=>!isRevokedSigner(s)&&!s.profileUid&&!s.uid).length,files};
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
    const recipientKeyHash=await sha256Hex(recipient.recipientKey);
    const id="delivery-"+envelope.id+"-"+recipientKeyHash.slice(0,32);
    let record=await ctx.meta.get("signatureDistributions",id);
    // Preserve records written by the email-deduplicating implementation. One
    // legacy record can satisfy only one recipient position; it is never cloned.
    if(!record&&recipient.email){
      const legacyHash=await sha256Hex(recipient.email);
      const legacyId="delivery-"+envelope.id+"-"+legacyHash.slice(0,32);
      const legacy=await ctx.meta.get("signatureDistributions",legacyId);
      if(legacy&&(!legacy.recipientKey||legacy.recipientKey===recipient.recipientKey)){
        if(!legacy.recipientKey){
          await ctx.meta.update("signatureDistributions",legacyId,{
            recipientKey:recipient.recipientKey,
            recipientId:recipient.recipientKey,
            legacyRecipientRecord:true
          },{ifVersion:legacy._v});
        }
        record=await ctx.meta.get("signatureDistributions",legacyId);
      }
    }
    if(!record){
      const emailHash=recipient.email?await sha256Hex(recipient.email):null;
      const created={envelopeId:envelope.id,externalReference:envelope.externalReference||null,documentId:envelope.documentId,recipientKey:recipient.recipientKey,recipientId:recipient.recipientKey,recipientUid:recipient.uid,recipientEmail:recipient.email||"",recipientEmailHash:emailHash,maskedAddress:maskAddress(recipient.email),recipientName:recipient.name,recipientRoles:recipient.roles,signerIds:recipient.signerIds,fileName:completion.fileName,finalHash:completion.finalHash,status:recipient.email?"Pending":"Failed",attempts:0,lastError:recipient.email?null:"RECIPIENT_EMAIL_MISSING",stageCode:recipient.email?null:"BUILD_MESSAGE",replyCategory:"UNKNOWN",acceptedByMailServer:false,stageHistory:[],createdAt:ctx.now().toISOString()};
      try{await ctx.meta.create("signatureDistributions",id,created);}catch{record=await ctx.meta.get("signatureDistributions",id);if(!record)throw new Error("Unable to create the recipient distribution record.");}
      record=record||await ctx.meta.get("signatureDistributions",id);
    }
    if(!record||record.status==="Sent"||record.status==="Unknown"||record.status==="Sending")continue;
    if(record.status==="Failed"&&!retryFailed&&Number(record.attempts||0)>0)continue;
    if(!recipient.email)continue;
    if(typeof ctx.sendCompletionEmail!=="function"){await update(ctx,id,{status:"Failed",acceptedByMailServer:false,stageCode:"SMTP_CONNECT",replyCategory:"UNKNOWN",lastError:"EMAIL_TRANSPORT_NOT_CONFIGURED",lastAttemptAt:ctx.now().toISOString()});continue;}
    const priorAttempts=Number(record.attempts||0);
    let activeAttempt=0;
    try{
      const result=await sendWithRetry(async attempt=>{
        activeAttempt=attempt;
        await update(ctx,id,{status:"Sending",attempts:priorAttempts+attempt,lastAttemptAt:ctx.now().toISOString(),lastError:null});
        return ctx.sendCompletionEmail({
          to:recipient.email,name:recipient.name,recipientRoles:recipient.roles,title:envelope.title||completion.fileName,
          fileName:completion.fileName,completedAt:completion.completedAt,finalHash:completion.finalHash,bytes:finalBytes,
          onStage:async(stage,outcome,category,metadata={})=>{
            try{
              const current=await ctx.meta.get("signatureDistributions",id);
              if(!current)return;
              const stageEvent={attempt:priorAttempts+activeAttempt,stage:String(stage||"").slice(0,32),outcome:outcome==="success"?"success":"failure",replyCategory:["ACCEPTED","RATE_LIMITED","AUTH_FAILED","CONNECTION_REFUSED","MAILBOX_FULL","RECIPIENT_REJECTED","UNKNOWN"].includes(category)?category:"UNKNOWN",at:ctx.now().toISOString(),...(metadata.messageId?{messageId:String(metadata.messageId).slice(0,180)}:{})};
              await ctx.meta.update("signatureDistributions",id,{stageCode:outcome==="failure"?stageEvent.stage:current.stageCode,replyCategory:stageEvent.replyCategory,stageHistory:[...(current.stageHistory||[]),stageEvent].slice(-30)},{ifVersion:current._v});
            }catch(stageError){ctx.logger?.error?.("SIGNATURE_DISTRIBUTION_STAGE_AUDIT_FAILED",{envelopeId:envelope.id,stage:String(stage||"").slice(0,32),errorType:String(stageError?.name||"Error").slice(0,40)});}
          }
        });
      },{attempts:3,logger:{error(){}},shouldRetry:shouldRetryCompletionEmail,...(ctx.sleep?{sleep:ctx.sleep}:{})});
      await update(ctx,id,{status:"Sent",acceptedByMailServer:true,deliveryOutcome:"accepted",stageCode:null,replyCategory:"ACCEPTED",attempts:priorAttempts+activeAttempt,sentAt:ctx.now().toISOString(),messageId:clean(result?.messageId||result||"").slice(0,180),lastError:null});
    }catch(error){
      const ambiguous=error?.deliveryOutcome==="unknown"||(stageCode(error)==="SUBMIT"&&!["RATE_LIMITED","MAILBOX_FULL","RECIPIENT_REJECTED","AUTH_FAILED"].includes(replyCategory(error)));
      const finalStatus=ambiguous?"Unknown":"Failed";
      await update(ctx,id,{status:finalStatus,acceptedByMailServer:false,deliveryOutcome:ambiguous?"unknown":"not-accepted",stageCode:stageCode(error),replyCategory:replyCategory(error),attempts:priorAttempts+Math.max(1,activeAttempt),failedAt:ctx.now().toISOString(),lastError:safeError(error,recipient.email)});
      ctx.logger?.error?.("SIGNATURE_COMPLETION_EMAIL_FAILED",{envelopeId:envelope.id,recipientDomain:recipient.email.split("@")[1]||"unknown",status:finalStatus,stageCode:stageCode(error),replyCategory:replyCategory(error),attempt:priorAttempts+Math.max(1,activeAttempt)});
    }
  }
  const summary=await getSignatureDistributionSummary(ctx,envelope.id,envelope);
  await persistEnvelopeDistribution(ctx,envelope.id,summary);
  return summary;
}
export async function retryFailedSignatureDistributions(ctx,user,envelopeId){
  const envelope=await ctx.meta.get("envelopes",envelopeId);
  if(!envelope||(envelope.createdBy!==user?.uid&&user?.isAdmin!==true)){const error=new Error("Not authorized.");error.status=403;throw error;}
  if(envelope.status!=="Completed"||!envelope.completion){const error=new Error("Only completed documents can be redistributed.");error.status=409;throw error;}
  // Keep the two delivery trails independent: an exception in one must never
  // prevent the other from being attempted or change its recorded outcome.
  let distribution=null,personalCopies=null;
  try{
    distribution=await distributeCompletedSignatureDocument(ctx,envelope,envelope.completion,{retryFailed:true});
  }catch(error){
    ctx.logger?.error?.("SIGNATURE_EMAIL_DISTRIBUTION_RETRY_FAILED",{envelopeId,errorType:String(error?.name||"Error").slice(0,60)});
    distribution={status:"Error",error:"Email distribution could not be reconciled. My Documents processing will continue."};
  }
  try{
    personalCopies=await distributeCompletedPersonalCopies(ctx,envelope,envelope.completion,{retryFailed:true});
  }catch(error){
    ctx.logger?.error?.("SIGNATURE_MY_DOCUMENTS_RETRY_FAILED",{envelopeId,errorType:String(error?.name||"Error").slice(0,60)});
    personalCopies={status:"Error",error:"My Documents copies could not be reconciled. Email distribution remains independent."};
  }
  return{ok:true,envelopeId,distribution,personalCopies};
}
