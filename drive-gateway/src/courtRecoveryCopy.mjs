import { sha256Hex, HttpError } from "./util.mjs";

const owns=(envelope,user)=>Boolean(user?.uid)&&(
  envelope.createdBy===user.uid||envelope.createdByUid===user.uid||
  envelope.ownerUid===user.uid||user.isAdmin===true||user.isOwner===true
);

/** Read the preserved Drive object by its recorded ID; deployment switch is never a data selector. */
export async function buildUnarchivedCompletedCopy(ctx,user,envelopeId,emergencyBuilder) {
  const envelope=await ctx.meta.get("envelopes",envelopeId);
  if(!envelope) throw new HttpError(404,"Envelope not found.");
  if(!owns(envelope,user)) throw new HttpError(403,"Not authorized.");
  if(!["CompletionFailed","Completing"].includes(envelope.status))
    throw new HttpError(409,"Only an archive-pending finalisation can provide an unarchived copy.");
  const pending=envelope.completion?.archivePending;
  const dataEnvironment=String(envelope.dataEnvironment||"").trim().toUpperCase();
  const fallback=async code=>{
    if(typeof emergencyBuilder!=="function"){const e=new HttpError(409,code);e.code=code;throw e;}
    const emergency=await emergencyBuilder(ctx,user,envelopeId);
    if(!emergency?.ok){const e=new HttpError(emergency?.status||409,emergency?.stages?.at(-1)?.error||"EMERGENCY_RETRIEVAL_FAILED");e.code=code;throw e;}
    return {bytes:emergency.bytes,hash:emergency.outputHash,recordedHash:emergency.outputHash,comparison:"MATCH",source:"EMERGENCY_BUILD",label:"Unarchived copy; the envelope is not yet Completed",generatedAt:ctx.now().toISOString(),fileName:"emergency-retrieval-copy.pdf",environment:dataEnvironment,fallbackCode:code};
  };
  if(!["TRIAL","ACTUAL","TEST"].includes(dataEnvironment))return fallback("PRESERVED_COPY_ENV_MISMATCH");
  if(!pending?.storageId||!pending?.finalHash)return fallback("PRESERVED_COPY_MISSING");
  if(String(pending.environment||"").trim().toUpperCase()!==dataEnvironment)return fallback("PRESERVED_COPY_ENV_MISMATCH");
  let bytes;
  try{bytes=await ctx.storage.get(pending.storageId);}catch{return fallback("PRESERVED_COPY_MISSING");}
  if(!(bytes instanceof Uint8Array)||!bytes.length)return fallback("PRESERVED_COPY_MISSING");
  const hash=await sha256Hex(bytes);
  const preservedHash=String(pending.finalHash).trim().toLowerCase();
  const completedHash=String(envelope.completion?.finalHash).trim().toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(preservedHash)||!/^[a-f0-9]{64}$/.test(completedHash)||hash!==preservedHash||hash!==completedHash)return fallback("HASH_MISMATCH");
  return {bytes,hash,recordedHash:preservedHash,comparison:"MATCH",source:"PRESERVED_COPY",label:"Unarchived copy; the envelope is not yet Completed",generatedAt:pending.createdAt||ctx.now().toISOString(),fileName:pending.fileName||"unarchived-completed-copy.pdf",environment:pending.environment};
}
