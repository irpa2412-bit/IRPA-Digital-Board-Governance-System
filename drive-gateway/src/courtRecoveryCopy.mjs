import { sha256Hex, HttpError } from "./util.mjs";

const owns=(envelope,user)=>Boolean(user?.uid)&&(
  envelope.createdBy===user.uid||envelope.createdByUid===user.uid||
  envelope.ownerUid===user.uid||user.isAdmin===true||user.isOwner===true
);

/**
 * Returns only the exact PDF bytes already preserved by the ARCHIVE_PENDING
 * finalisation path. This endpoint never rebuilds, signs, archives, or mutates.
 */
export async function buildUnarchivedCompletedCopy(ctx,user,envelopeId) {
  const envelope=await ctx.meta.get("envelopes",envelopeId);
  if(!envelope) throw new HttpError(404,"Envelope not found.");
  if(!owns(envelope,user)) throw new HttpError(403,"Not authorized.");
  if(!["CompletionFailed","Completing"].includes(envelope.status))
    throw new HttpError(409,"Only an archive-pending finalisation can provide an unarchived copy.");
  const pending=envelope.completion?.archivePending;
  const runtimeEnvironment=String(ctx.env?.IRPA_ENVIRONMENT||"").trim().toLowerCase();
  const dataEnvironment=String(envelope.dataEnvironment||"").trim().toUpperCase();
  if(!["TRIAL","ACTUAL","TEST"].includes(dataEnvironment)||!pending?.environment||String(pending.environment).toUpperCase()!==dataEnvironment||(runtimeEnvironment==="staging"&&dataEnvironment==="ACTUAL"))
    throw new HttpError(409,"The preserved copy environment does not match the envelope data environment.");
  if(!pending?.storageId||!pending?.finalHash)
    throw new HttpError(409,"No preserved ARCHIVE_PENDING PDF is available.");
  const bytes=await ctx.storage.get(pending.storageId);
  if(!(bytes instanceof Uint8Array)||!bytes.length)
    throw new HttpError(409,"The preserved ARCHIVE_PENDING PDF is unavailable.");
  const hash=await sha256Hex(bytes);
  if(hash!==String(pending.finalHash).toLowerCase())
    throw new HttpError(409,"The preserved PDF failed its SHA-256 integrity check.");
  return {
    bytes,
    hash,
    recordedHash:pending.finalHash,
    comparison:"MATCH",
    generatedAt:pending.createdAt||ctx.now().toISOString(),
    fileName:pending.fileName||"unarchived-completed-copy.pdf",
    environment:pending.environment||envelope.dataEnvironment||null
  };
}
