import { sha256Hex, HttpError } from "./util.mjs";

const owns=(envelope,user)=>Boolean(user?.uid)&&(
  envelope.createdBy===user.uid||envelope.createdByUid===user.uid||
  envelope.ownerUid===user.uid||user.isAdmin===true||user.isOwner===true
);
function recoveryError(code,message){
  const error=new HttpError(409,message);
  error.code=code;
  return error;
}

/**
 * Reads the existing preserved PDF by its recorded storage ID. The preserved
 * record's environment is checked against the envelope, never against the
 * current Worker deployment or a request-time environment switch.
 */
export async function buildUnarchivedCompletedCopy(ctx,user,envelopeId) {
  let envelope=await ctx.meta.get("envelopes",envelopeId);
  if(!envelope) envelope=await ctx.meta.get("signatureEnvelopes",envelopeId);
  if(!envelope) throw new HttpError(404,"Envelope not found.");
  if(!owns(envelope,user)) throw new HttpError(403,"Not authorized.");
  if(!["CompletionFailed","Completing"].includes(envelope.status))
    throw new HttpError(409,"Only an archive-pending finalisation can provide an unarchived copy.");
  const pending=envelope.completion?.archivePending;
  const dataEnvironment=String(envelope.dataEnvironment||"").trim().toUpperCase();
  if(!["TRIAL","ACTUAL","TEST"].includes(dataEnvironment))
    throw recoveryError("PRESERVED_COPY_ENV_MISMATCH","The envelope data environment is not valid.");
  if(!pending||!pending.storageId)
    throw recoveryError("PRESERVED_COPY_MISSING","No preserved PDF is recorded.");
  if(!pending.environment||String(pending.environment).trim().toUpperCase()!==dataEnvironment)
    throw recoveryError("PRESERVED_COPY_ENV_MISMATCH","The preserved copy environment differs from the envelope data environment.");
  const preservedHash=String(pending.finalHash||"").trim().toLowerCase();
  const envelopeHash=String(envelope.completion?.finalHash||"").trim().toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(preservedHash)||! /^[a-f0-9]{64}$/.test(envelopeHash))
    throw recoveryError("HASH_MISMATCH","The preserved or envelope completed SHA-256 record is missing or invalid.");
  let bytes;
  try{bytes=await ctx.storage.get(pending.storageId);}
  catch{throw recoveryError("PRESERVED_COPY_UNREADABLE","The preserved PDF could not be read.");}
  if(!(bytes instanceof Uint8Array)||!bytes.length)
    throw recoveryError("PRESERVED_COPY_MISSING","The preserved PDF is unavailable.");
  const hash=await sha256Hex(bytes);
  if(hash!==preservedHash||hash!==envelopeHash)
    throw recoveryError("HASH_MISMATCH","The preserved PDF does not match both recorded SHA-256 values.");
  return {
    bytes,hash,recordedHash:preservedHash,comparison:"MATCH",
    generatedAt:pending.createdAt||ctx.now().toISOString(),
    fileName:pending.fileName||"unarchived-completed-copy.pdf",
    environment:pending.environment
  };
}
