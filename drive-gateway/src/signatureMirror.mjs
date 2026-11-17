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
      uid: s.uid || null, signerId:s.id||null, identityType:s.identityType||"account", name: s.name || "", email: s.email || "",
      status: s.status || "", signedAt: s.signedAt || null,
      role: s.role || prior?.role || prior?.action || "",
      action: s.action || prior?.action || prior?.role || "",
      authorityRole: s.authorityVerification?.authorityRole || "",
      ownerDeclaredParticulars:s.declaredParticulars||{},
      signerDeclarations:s.signerDeclarations||{},
      declarationDiscrepancy:s.declarationDiscrepancy||null
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
  const documentId = clean(existing.documentId || envelope.documentId);
  if (!documentId) throw new Error("Completed signature mirror is missing its controlled document ID.");
  const documentPath = "documents/" + documentId;
  const sourceDocument = await getDocument(documentPath);
  if (!sourceDocument) throw new Error("The controlled document mirror was not found for signature completion.");
  const primaryArchive = (completion.files || []).find(file => file?.kind === "archive") || null;
  await updateDocument(documentPath, {
    signatureEnvelopeId: envelopeId,
    signatureStatus: "Completed",
    workflowActionStatus: "Signed",
    lastWorkflowAction: "Signature",
    lastWorkflowActionUid: lastSignedByUid || "",
    lastWorkflowActionAt: completion.completedAt || timestamp,
    completedDocumentUrl: signedDocumentUrl,
    ownerCompletedDocumentUrl: signedDocumentUrl,
    ownerCompletedDocumentPath: primaryArchive?.path || signedDocumentUrl,
    ownerRecordStatus: "Completed",
    lastCompletedDocumentHash: completion.finalHash,
    gatewayArchiveStorageId: primaryArchive?.id || signedFileId,
    gatewayArchivePath: primaryArchive?.path || "",
    gatewayArchiveState: "Final Completed Document",
    gatewaySigningStatus: "Completed",
    gatewayFinalHash: completion.finalHash,
    updatedAt: timestamp
  });
  for (const signer of signers.filter(s => s.status === "Signed")) {
    const assignedSigner=(envelope.signers||[]).find(x=>(x.uid&&x.uid===signer.uid)||(x.email&&x.email===signer.email));
    const signerCopy=(completion.files||[]).find(file=>file?.kind==="signer-copy"&&file.signerId===(assignedSigner?.id||""));
    if(!signerCopy?.id)throw new Error("Completed signer archive copy is missing for an assigned signer.");
    const signerArchiveUrl="https://drive.google.com/file/d/"+encodeURIComponent(signerCopy.id)+"/view";
    const signatureRecordId="gateway-"+envelopeId+"-"+clean(signer.uid||assignedSigner?.id||signer.email);
    await updateDocument("signatures/"+signatureRecordId,{
      envelopeId,documentId:clean(existing.documentId||envelope.documentId),
      recordOrigin:existing.recordOrigin||"PRODUCTION",trialData:existing.trialData===true,
      documentReference:clean(existing.documentReference||existing.envelopeReference||envelope.externalReference),
      documentTitle:clean(existing.title||envelope.title),
      signerUid:signer.uid||null,signerId:assignedSigner?.id||null,signerIdentityType:assignedSigner?.identityType||"email-link",signerEmail:signer.email||"",signerName:signer.name||"",
      workflowRole:signer.role||signer.action||signer.signerDeclarations?.occupation||signer.declaredParticulars?.occupation||"",
      signatureAuthority:signer.authorityRole||signer.signerDeclarations?.occupation||signer.declaredParticulars?.occupation||"",
      signatureAuthorityVerificationStatus:signer.authorityRole?"Verified":"NotApplicable",
      ownerDeclaredParticulars:assignedSigner?.declaredParticulars||{},
      signerDeclarations:assignedSigner?.signerDeclarations||{},
      declarationDiscrepancy:assignedSigner?.declarationDiscrepancy||null,
      signatureStatus:"Signed",status:"Signed",signedAt:signer.signedAt||timestamp,
      signerArchiveUrl,signerArchiveFileId:signerCopy.id,
      gatewayEnvelopeId:envelope.id,gatewayDocumentHash:completion.finalHash,
      cryptographicEvidenceStatus:(completion.signerEvidence||[]).some(item=>item.signerId===assignedSigner?.id)?"Verified":"GatewayAuditOnly",archiveProtocol:(completion.signerEvidence||[]).some(item=>item.signerId===assignedSigner?.id)?"IRPA-GATEWAY-CRYPTOGRAPHIC-EVIDENCE-1":"IRPA-GATEWAY-AUDIT-CHAIN-1",
      immutable:true
    });

    const signerEventId = "gateway-signed-" + envelopeId + "-" + clean(signer.uid || assignedSigner?.id || signer.email);
    const signerEventPath = "signatureEvents/" + signerEventId;
    if (!(await getDocument(signerEventPath))) {
      await updateDocument(signerEventPath, {
        envelopeId,
        event: "Gateway Signer Signed",
        actorUid: signer.uid || "",
        actorEmail: signer.email || "",
        signerId: assignedSigner?.id || null,
        declarationDiscrepancy: assignedSigner?.declarationDiscrepancy || null,
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
      actorEmail: signers.find(s => s.uid === lastSignedByUid)?.email || [...signers].reverse().find(s => s.status === "Signed")?.email || "",
      createdAt: timestamp
    });
  }
}
