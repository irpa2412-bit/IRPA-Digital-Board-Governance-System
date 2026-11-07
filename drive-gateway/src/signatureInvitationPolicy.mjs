export function canSendSignatureInvitation({actorUid,ownerUid,senderUid,currentSignerUid,signerUid,signingMode,recipients=[],workflowHistory=[]}={}) {
  const actor=String(actorUid||"");
  const target=String(signerUid||"");
  const owner=String(ownerUid||senderUid||"");
  if(!actor||!target)return false;
  if(actor===owner)return true;
  if(String(signingMode||"Sequential")!=="Sequential"||target!==String(currentSignerUid||""))return false;
  const actorIndex=recipients.findIndex(item=>String(item?.uid||"")===actor);
  const targetIndex=recipients.findIndex(item=>String(item?.uid||"")===target);
  if(actorIndex<0||targetIndex<=actorIndex)return false;
  const actorRecipient=recipients[actorIndex]||{};
  const signed=String(actorRecipient.status||"").toLowerCase()==="signed"||Boolean(actorRecipient.signedAt||actorRecipient.completedAt)||
    workflowHistory.some(entry=>String(entry?.uid||entry?.signerUid||"")===actor&&Boolean(entry?.completedAt||entry?.signedAt||/signed|completed/i.test(String(entry?.status||entry?.action||""))));
  return signed;
}
