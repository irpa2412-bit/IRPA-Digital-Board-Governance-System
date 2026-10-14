export function canProvisionSignatureProfileFolder({ authenticatedUid, requestedUid, isAdmin = false } = {}) {
  const actor = String(authenticatedUid || "").trim();
  const target = String(requestedUid || "").trim();
  if (!actor || !target) return false;
  return isAdmin === true || actor === target;
}

export function canUploadSignedDocument({
  authenticatedUid,
  signerUid,
  documentId,
  envelopeDocumentId,
  envelopeParticipantUids = [],
  actionUids = [],
  signingMode = "Sequential",
  currentSignerUid = null,
} = {}) {
  const actor = String(authenticatedUid || "").trim();
  const signer = String(signerUid || "").trim();
  const docId = String(documentId || "").trim();
  const envelopeDocId = String(envelopeDocumentId || "").trim();
  if (!actor || actor !== signer || !docId || docId !== envelopeDocId) return false;
  if (!Array.isArray(envelopeParticipantUids) || !envelopeParticipantUids.includes(actor)) return false;
  if (!Array.isArray(actionUids) || !actionUids.includes(actor)) return false;
  if (signingMode === "Sequential" && String(currentSignerUid || "") !== actor) return false;
  return signingMode === "Sequential" || signingMode === "Parallel";
}

export function canReadSignatureAsset({
  authenticatedUid,
  purpose,
  ownerUid,
  documentId = "",
  envelopeId = "",
  metadataDocumentId = "",
  metadataEnvelopeId = "",
  isAdmin = false,
  documentOwnerUid = "",
  authorizedUids = [],
  envelopeParticipantUids = [],
  envelopeFileMatches = false,
} = {}) {
  const actor = String(authenticatedUid || "").trim();
  if (!actor) return false;

  if (purpose === "Signature Profile") {
    return String(ownerUid || "") === actor;
  }

  if (purpose === "Signed Documents Archive") {
    const docId = String(documentId || "").trim();
    const envId = String(envelopeId || "").trim();
    if (!docId || !envId || !Array.isArray(envelopeParticipantUids) || !envelopeParticipantUids.includes(actor)) {
      return false;
    }
    if (metadataDocumentId && String(metadataDocumentId) !== docId) return false;
    if (metadataEnvelopeId && String(metadataEnvelopeId) !== envId) return false;
    return (String(metadataDocumentId || "") === docId && String(metadataEnvelopeId || "") === envId)
      || envelopeFileMatches === true;
  }

  const docId = String(documentId || "").trim();
  if (!docId || String(metadataDocumentId || "") !== docId) return false;
  return isAdmin === true
    || String(documentOwnerUid || "") === actor
    || (Array.isArray(authorizedUids) && authorizedUids.includes(actor));
}
