const clean = value => String(value ?? "").trim();

export async function persistCompletedSignatureEnvelope({envelope, completion, getDocument, updateDocument, now = () => new Date().toISOString()}) {
  if (!envelope?.externalReference) return;
  if (typeof getDocument !== "function" || typeof updateDocument !== "function") throw new Error("Firestore signature mirror dependencies are not configured.");
  const envelopeId = clean(envelope.externalReference);
  const path = "signatureEnvelopes/" + envelopeId;
  const existing = await getDocument(path);
  if (!existing) throw new Error("The portal signature envelope was not found for gateway completion.");
  const signedFileId = clean(completion?.primaryStorageId);
  if (!signedFileId) throw new Error("Completed signed PDF reference is missing.");
  const signedDocumentUrl = "https://drive.google.com/file/d/" + encodeURIComponent(signedFileId) + "/view";
  const priorSigners = Array.isArray(existing.signers) ? existing.signers : [];
  const signers = (envelope.signers || []).map(s => {
    const prior = priorSigners.find(p => (s.uid && p.uid === s.uid) || (s.email && String(p.email || "").toLowerCase() === String(s.email).toLowerCase()));
    return {
      uid: s.uid || null, name: s.name || "", email: s.email || "",
      status: s.status || "", signedAt: s.signedAt || null,
      role: s.role || prior?.role || prior?.action || "",
      action: s.action || prior?.action || prior?.role || "",
      authorityRole: s.authorityVerification?.authorityRole || ""
    };
  });
  const lastSignedByUid = [...signers].reverse().find(s => s.uid && s.status === "Signed")?.uid || null;
  const timestamp = now();

  await updateDocument(path, {
    status: "Completed", signers, completedAt: completion.completedAt,
    signedDocumentUrl, ownerCompletedDocumentUrl: signedDocumentUrl,
    signedDocumentPath: signedDocumentUrl, signedPdfReference: signedFileId,
    lastSignedByUid, gatewayStatus: "Completed", gatewayFinalHash: completion.finalHash,
    gatewaySigningStatus: "Completed", gatewayStatusUpdatedAt: timestamp, updatedAt: timestamp
  });
  for (const signer of signers.filter(s => s.uid && s.status === "Signed")) {
    const signerEventId = "gateway-signed-" + envelopeId + "-" + clean(signer.uid);
    const signerEventPath = "signatureEvents/" + signerEventId;
    if (!(await getDocument(signerEventPath))) {
      await updateDocument(signerEventPath, {
        envelopeId,
        event: "Gateway Signer Signed",
        actorUid: signer.uid,
        signedAt: signer.signedAt || timestamp
      });
    }
  }
  const eventId = "gateway-completed-" + envelopeId;
  const completionEventPath = "signatureEvents/" + eventId;
  if (!(await getDocument(completionEventPath))) {
    await updateDocument(completionEventPath, {
      envelopeId,
      event: "Gateway Signing Completed",
      details: {
        documentId: clean(existing.documentId || envelope.documentId),
        eventType: "Gateway Signing Completed", action: "COMPLETED", status: "Completed",
        signedDocumentUrl, signedPdfReference: signedFileId,
        finalHash: completion.finalHash, completedAt: completion.completedAt, source: "drive-gateway"
      },
      actorUid: lastSignedByUid || "",
      actorEmail: signers.find(s => s.uid === lastSignedByUid)?.email || "",
      createdAt: timestamp
    });
  }
}
