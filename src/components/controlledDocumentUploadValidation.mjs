const ALLOWED_DOCUMENT_TYPES = new Set([
  "Governance",
  "Administrative",
  "Finance",
  "Procurement",
  "Administrator"
]);

const UNSUPPORTED_FORMAT_MESSAGE =
  "The selected file format is not supported. Choose PDF, Word, Excel, PowerPoint, OpenDocument, text/CSV, or an image document.";

/**
 * Return an actionable validation message for the controlled document form.
 *
 * The submit control remains clickable when required fields are missing so
 * the user can receive a specific explanation. This is UI validation only;
 * server-side authentication and authorization remain authoritative.
 */
export function validateControlledDocumentUpload({
  authenticated,
  file,
  documentType,
  allowRestrictedUpload = false,
  contentType = "",
  maxBytes = 10 * 1024 * 1024
} = {}) {
  if (!authenticated) return "You must be signed in.";
  if (!documentType) return "Choose a document type before uploading.";
  if (!ALLOWED_DOCUMENT_TYPES.has(String(documentType))) {
    return "Choose one of the five supported document types.";
  }
  if (documentType === "Administrator" && !allowRestrictedUpload) {
    return "Administrator/restricted documents require special permission.";
  }
  if (!file) return "Select a document file to upload.";
  if (!Number.isFinite(Number(file.size)) || Number(file.size) <= 0) {
    return "The selected document is empty.";
  }
  if (Number(file.size) > maxBytes) {
    return "Documents must not exceed 10 MB.";
  }
  if (String(contentType || "").toLowerCase() === "application/octet-stream") {
    return UNSUPPORTED_FORMAT_MESSAGE;
  }
  return "";
}
