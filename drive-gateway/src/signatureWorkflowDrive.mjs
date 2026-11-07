const PDF_MIME = "application/pdf";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const fields = "id,name,mimeType,size,parents,description,appProperties,trashed";

export async function ensureVerifiedSignatureWorkflowPdfCopy({
  envelopeId, documentId, sourceFileId, sourceSha256, sourceByteLength, ownerUid,
  accessToken, getRootFolderName, findOrCreateFolder, driveFetch, downloadBytes, hashBytes
}) {
  if (!envelopeId || !documentId || !sourceFileId || !ownerUid) throw new Error("Envelope, document, source file and owner references are required.");
  if (!/^[a-f0-9]{64}$/i.test(String(sourceSha256 || ""))) throw new Error("The controlled source PDF SHA-256 is missing or invalid.");
  const rootId = await findOrCreateFolder(getRootFolderName());
  const workflowsId = await findOrCreateFolder("Signature Workflows", rootId, {
    irpaGovernanceSignatureWorkflow:true, purpose:"Signature Workflow Working Files"
  });
  const folderName = "IRPA-WORKFLOW-" + envelopeId;
  const folderId = await findOrCreateFolder(folderName, workflowsId, {
    irpaGovernanceSignatureWorkflow:true, envelopeId, ownerUid, purpose:"Signature Workflow Working File"
  });
  const sourceMeta = await driveFetch("/drive/v3/files/" + encodeURIComponent(sourceFileId) + "?fields=" + fields);
  if (sourceMeta.trashed || sourceMeta.id !== sourceFileId || sourceMeta.mimeType !== PDF_MIME) {
    throw new Error("The controlled source file is missing, trashed, or is not a PDF.");
  }
  const sourceBytes = await downloadBytes(sourceFileId);
  if (sourceBytes.length < 8 || new TextDecoder().decode(sourceBytes.subarray(0,5)) !== "%PDF-") {
    throw new Error("The controlled source file content is not a valid PDF.");
  }
  const actualSourceHash = await hashBytes(sourceBytes);
  if (actualSourceHash !== String(sourceSha256).toLowerCase()) throw new Error("The controlled source PDF hash does not match the draft integrity record.");
  if (Number(sourceByteLength) !== sourceBytes.length) throw new Error("The controlled source PDF byte length does not match the draft integrity record.");

  const copyName = "IRPA-ENVELOPE-" + envelopeId + ".pdf";
  const appProperties = { irpaEnvelopeId:String(envelopeId), irpaDocumentId:String(documentId), irpaSourceFileId:String(sourceFileId), irpaSourceSha256:actualSourceHash };
  const q = [
    "name='" + copyName.replace(/'/g, "\\'") + "'",
    "'" + folderId + "' in parents",
    "trashed=false",
    "appProperties has { key='irpaEnvelopeId' and value='" + String(envelopeId).replace(/'/g, "\\'") + "' }"
  ].join(" and ");
  const listed = await driveFetch("/drive/v3/files?q=" + encodeURIComponent(q) + "&spaces=drive&pageSize=20&fields=files(" + fields + ")");
  const matches = Array.isArray(listed.files) ? listed.files : [];
  if (matches.length > 1) throw new Error("Multiple envelope PDF copies were found; refusing to select or create a duplicate.");
  let fileId = matches[0]?.id || "";
  if (!fileId) {
    const copied = await driveFetch("/drive/v3/files/" + encodeURIComponent(sourceFileId) + "/copy?supportsAllDrives=true&fields=" + fields, {
      method:"POST",
      body:JSON.stringify({
        name:copyName,
        parents:[folderId],
        mimeType:PDF_MIME,
        appProperties,
        description:JSON.stringify({
          irpaGovernance:true, irpaSignatureWorkflowCopy:true, envelopeId, documentId,
          ownerUid, sourceFileId, sourceSha256:actualSourceHash, purpose:"IRPA Signature Envelope PDF"
        })
      })
    });
    fileId = String(copied.id || "");
    if (!fileId) throw new Error("Google Drive did not return the copied envelope PDF file ID.");
  }

  const verifiedMeta = await driveFetch("/drive/v3/files/" + encodeURIComponent(fileId) + "?fields=" + fields);
  let description = {};
  try { description = JSON.parse(verifiedMeta.description || "{}"); } catch {}
  const props = verifiedMeta.appProperties || {};
  if (verifiedMeta.trashed || verifiedMeta.id !== fileId || verifiedMeta.mimeType !== PDF_MIME ||
      !Array.isArray(verifiedMeta.parents) || !verifiedMeta.parents.includes(folderId) ||
      props.irpaEnvelopeId !== String(envelopeId) || props.irpaDocumentId !== String(documentId) ||
      props.irpaSourceFileId !== String(sourceFileId) || props.irpaSourceSha256 !== actualSourceHash ||
      description.irpaSignatureWorkflowCopy !== true || String(description.envelopeId || "") !== String(envelopeId) ||
      String(description.documentId || "") !== String(documentId) || String(description.sourceFileId || "") !== String(sourceFileId)) {
    throw new Error("The copied envelope file failed its Drive ID, PDF type, parent-folder, or provenance verification.");
  }
  const copiedBytes = await downloadBytes(fileId);
  if (copiedBytes.length !== sourceBytes.length) throw new Error("The copied envelope PDF byte length differs from the controlled source.");
  const copiedSha256 = await hashBytes(copiedBytes);
  if (copiedSha256 !== actualSourceHash) throw new Error("The copied envelope PDF SHA-256 differs from the controlled source.");
  return {
    folderId, folderName, fileId, fileName:verifiedMeta.name || copyName,
    mimeType:verifiedMeta.mimeType, byteLength:copiedBytes.length,
    sourceFileId, sourceSha256:actualSourceHash, copiedSha256,
    verifiedAt:new Date().toISOString(), copyUrl:"drive://" + fileId,
    folderPath:"IRPA Governance System/Signature Workflows/" + folderName
  };
}
