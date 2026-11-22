import { buildSignedPdf } from "./pdf.mjs";
import { sha256Hex, HttpError } from "./util.mjs";

const owns=(envelope,user)=>Boolean(user?.uid)&&(
  envelope.createdBy===user.uid||envelope.createdByUid===user.uid||
  envelope.ownerUid===user.uid||user.isAdmin===true||user.isOwner===true
);

/**
 * Regenerates the completed representation from the verified source and signed
 * envelope evidence. This path is deliberately read-only: it never calls meta
 * mutation methods, storage.put/delete, email, Drive, or certificate signing.
 */
export async function buildUnarchivedCompletedCopy(ctx,user,envelopeId) {
  const envelope=await ctx.meta.get("envelopes",envelopeId);
  if(!envelope) throw new HttpError(404,"Envelope not found.");
  if(!owns(envelope,user)) throw new HttpError(403,"Not authorized.");
  if(!["CompletionFailed","Completing"].includes(envelope.status))
    throw new HttpError(409,"Only an incomplete finalisation can produce an unarchived copy.");
  const events=Array.isArray(envelope.events)?envelope.events:[];
  const document=await ctx.meta.get("documents",envelope.documentId);
  if(!document?.primaryStorageId) throw new HttpError(409,"Verified source PDF reference is unavailable.");
  const original=await ctx.storage.get(document.primaryStorageId);
  if(!(original instanceof Uint8Array)||!original.length)
    throw new HttpError(409,"Verified source PDF bytes are unavailable.");
  const sourceHash=await sha256Hex(original);
  const expected=String(envelope.documentHash||document.sha256||document.hash||"").toLowerCase();
  if(!/^[0-9a-f]{64}$/.test(expected)||sourceHash!==expected)
    throw new HttpError(409,"Source PDF hash verification failed.");
  const completedAt=ctx.now().toISOString();
  const bytes=await buildSignedPdf(original,{
    envelopeId:envelope.id,documentId:envelope.documentId,title:envelope.title,
    originalHash:envelope.documentHash,chainHead:events.at(-1)?.hash||"GENESIS",
    events,completedAt,
    signers:(envelope.signers||[]).map(s=>({
      id:s.id,uid:s.uid,name:s.name,email:s.email,signedAt:s.signedAt,ip:s.ip,
      signatureType:s.signatureType,signatureValue:s.signatureValue,
      fieldValues:s.fieldValues||{},signerDeclarations:s.signerDeclarations||{},
      declarationDiscrepancy:s.declarationDiscrepancy||null
    })),
    fields:envelope.fields||[]
  });
  const hash=await sha256Hex(bytes);
  const recordedHash=String(envelope.completion?.finalHash||"").toLowerCase()||null;
  return {bytes,hash,recordedHash,comparison:recordedHash?(recordedHash===hash?"MATCH":"DIFFERENT"):"NO_RECORDED_HASH",generatedAt:completedAt};
}
