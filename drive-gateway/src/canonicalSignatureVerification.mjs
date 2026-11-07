import { importPublicKeyJwk, verifyCryptographicEvidence } from "./cryptographicGate.mjs";
import { sha256Hex } from "./util.mjs";

export async function verifyCanonicalSignatureEnvelope(ctx,envelopeId){
  const envelope=await ctx.meta.get("envelopes",envelopeId);
  if(!envelope||envelope.status!=="Completed"||!envelope.completion?.finalHash||!envelope.completion?.primaryStorageId)return{ok:false,error:"Canonical Gateway envelope is not completed."};
  const signers=Array.isArray(envelope.signers)?envelope.signers:[];
  if(!signers.length||signers.some(s=>s.status!=="Signed"||!s.uid||!s.signedAt))return{ok:false,error:"Canonical Gateway signer quorum is incomplete."};
  const bytes=await ctx.storage.get(envelope.completion.primaryStorageId);
  if(!bytes)return{ok:false,error:"Canonical signed PDF is unavailable."};
  const finalHash=await sha256Hex(bytes);
  if(finalHash!==envelope.completion.finalHash)return{ok:false,error:"Canonical signed PDF hash does not match the completion record."};
  const evidenceIds=Array.isArray(envelope.completion.cryptographicEvidenceIds)?envelope.completion.cryptographicEvidenceIds:[];
  if(evidenceIds.length!==signers.length||new Set(evidenceIds).size!==signers.length)return{ok:false,error:"Cryptographic evidence does not cover every required signer."};
  const rows=await ctx.meta.list("cryptographicEvidence");
  for(const signer of signers){
    const evidence=(rows||[]).find(row=>row?.evidenceId&&evidenceIds.includes(row.evidenceId)&&row.envelopeId===envelope.id&&row.signerUid===signer.uid&&row.documentHash===finalHash);
    if(!evidence)return{ok:false,error:"A required signer's cryptographic evidence is missing."};
    try{
      const publicKey=await importPublicKeyJwk(evidence.publicKeyJwk);
      if(!await verifyCryptographicEvidence(evidence,{documentHash:finalHash,signerUid:signer.uid,publicKey}))return{ok:false,error:"A required signer's cryptographic evidence failed verification."};
      const payload=JSON.parse(evidence.canonicalPayload||"{}");
      const signatureHash=await sha256Hex(String(signer.signatureValue||""));
      if(payload.envelopeId!==envelope.id||payload.signerId!==signer.id||payload.signatureHash!==signatureHash)return{ok:false,error:"Cryptographic evidence does not bind to the canonical signer record."};
    }catch{return{ok:false,error:"A required signer's cryptographic evidence could not be verified."};}
  }
  const lastSignedByUid=envelope.completion.lastSignedByUid;
  if(!lastSignedByUid||!signers.some(s=>s.uid===lastSignedByUid&&s.status==="Signed"))return{ok:false,error:"Canonical completion does not identify the final signer."};
  return{ok:true,envelope,finalHash,lastSignedByUid};
}
