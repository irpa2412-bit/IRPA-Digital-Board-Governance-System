export function signatureDraftOwnershipAllowed(sourceData,uid,isAdmin=false){
  const ownerUid=String(sourceData?.ownerUid||sourceData?.createdByUid||sourceData?.uploadedByUid||"");
  return Boolean(isAdmin)||Boolean(uid&&ownerUid===String(uid));
}
export function validateSignatureDraftRecipients(recipients,signingMode){
  if(!["Sequential","Parallel"].includes(String(signingMode||"Sequential")))return "Signing mode must be Sequential or Parallel.";
  if(!Array.isArray(recipients))return "Signing recipients must be a list.";
  const uids=new Set(),emails=new Set();
  for(const recipient of recipients){
    const uid=String(recipient?.uid||"").trim(),email=String(recipient?.email||"").trim().toLowerCase();
    if(uid&&uids.has(uid))return "Duplicate signer UID is not permitted.";
    if(email&&emails.has(email))return "Duplicate signer email is not permitted.";
    if(uid)uids.add(uid);
    if(email)emails.add(email);
  }
  return null;
}
