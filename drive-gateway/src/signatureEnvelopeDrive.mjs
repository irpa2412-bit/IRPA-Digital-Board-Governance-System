const PDF_MIME = "application/pdf";
const FOLDER_MIME = "application/vnd.google-apps.folder";

function safeName(value) {
  return String(value || "controlled-document").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "controlled-document";
}

async function hashBytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("");
}

export async function ensureEnvelopePdfCopy({
  env, accessToken, envelopeId, ownerUid, sourceFileId, sourceHash, sourceByteLength,
  sourceName, findOrCreateFolder, driveFetch, downloadBytes
}) {
  const id = String(envelopeId || "").trim();
  const sourceId = String(sourceFileId || "").trim();
  const expectedHash = String(sourceHash || "").trim().toLowerCase();
  const expectedLength = Number(sourceByteLength);
  if (!/^[A-Za-z0-9_-]{6,150}$/.test(id)) throw new Error("A valid envelope ID is required for PDF placement.");
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(sourceId)) throw new Error("The controlled source PDF has no valid Google Drive file ID.");
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || !Number.isSafeInteger(expectedLength) || expectedLength <= 0) {
    throw new Error("The controlled source PDF integrity hash and byte length are required.");
  }

  const rootId = await findOrCreateFolder(env, accessToken, env.DRIVE_ROOT_FOLDER_NAME || "IRPA Governance System");
  const workflowsId = await findOrCreateFolder(env, accessToken, "Signature Workflows", rootId, {
    irpaGovernanceSignatureWorkflow: true, purpose: "Signature Workflow Working Files"
  });
  const folderName = `IRPA-WORKFLOW-${id}`;
  const folderId = await findOrCreateFolder(env, accessToken, folderName, workflowsId, {
    irpaGovernanceSignatureWorkflow: true, envelopeId: id, ownerUid, purpose: "Signature Workflow Working File"
  });
  if (!folderId) throw new Error("Google Drive did not return the envelope working-folder ID.");

  const markerQuery = `'${folderId}' in parents and trashed=false and appProperties has { key='irpaEnvelopeId' and value='${id}' } and appProperties has { key='irpaSourceFileId' and value='${sourceId}' }`;
  const listed = await driveFetch(env, accessToken, `/drive/v3/files?q=${encodeURIComponent(markerQuery)}&spaces=drive&pageSize=10&fields=files(id,name,mimeType,parents,size,trashed,appProperties)`);
  const matches = Array.isArray(listed.files) ? listed.files : [];
  if (matches.length > 1) throw new Error("Multiple envelope PDF copies carry the same idempotency marker; manual reconciliation is required.");

  let copied = matches[0] || null;
  if (!copied) {
    const copyName = `${safeName(sourceName || "controlled-document")}-${id}.pdf`;
    copied = await driveFetch(env, accessToken, `/drive/v3/files/${encodeURIComponent(sourceId)}/copy?supportsAllDrives=true&fields=id,name,mimeType,parents,size,trashed,appProperties`, {
      method: "POST",
      body: JSON.stringify({
        name: copyName,
        parents: [folderId],
        appProperties: { irpaEnvelopeId: id, irpaSourceFileId: sourceId, irpaCopyPurpose: "signature-envelope-source" }
      })
    });
  }
  if (!copied?.id) throw new Error("Google Drive did not return the copied PDF file ID.");

  const metadata = await driveFetch(env, accessToken, `/drive/v3/files/${encodeURIComponent(copied.id)}?supportsAllDrives=true&fields=id,name,mimeType,parents,size,trashed,appProperties,md5Checksum`);
  const parents = Array.isArray(metadata.parents) ? metadata.parents.map(String) : [];
  if (metadata.id !== copied.id || metadata.mimeType !== PDF_MIME || metadata.trashed === true || !parents.includes(folderId)) {
    throw new Error("The envelope PDF copy failed verification: file identity, PDF MIME type, active status or expected parent folder did not match.");
  }
  if (metadata.appProperties?.irpaEnvelopeId !== id || metadata.appProperties?.irpaSourceFileId !== sourceId) {
    throw new Error("The envelope PDF copy is missing its idempotency metadata.");
  }

  const bytes = await downloadBytes(metadata.id);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== expectedLength) {
    throw new Error("The copied envelope PDF byte length does not match the controlled source.");
  }
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new Error("The copied envelope file does not contain a valid PDF signature.");
  }
  const copiedHash = await hashBytes(bytes);
  if (copiedHash !== expectedHash) throw new Error("The copied envelope PDF SHA-256 does not match the controlled source PDF.");

  return {
    envelopeFolderId: folderId,
    envelopeFolderName: folderName,
    envelopeFileId: metadata.id,
    envelopeFileName: metadata.name || copied.name || "",
    envelopeFileMimeType: metadata.mimeType,
    envelopeFileParentId: folderId,
    envelopeFileSize: bytes.byteLength,
    envelopeFileSha256: copiedHash,
    envelopeDocumentUrl: `drive://${metadata.id}`,
    sourceFileId: sourceId,
    sourceSha256: expectedHash,
    sourceByteLength: expectedLength
  };
}
