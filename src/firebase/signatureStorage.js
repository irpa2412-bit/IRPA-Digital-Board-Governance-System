import { getIdToken } from "firebase/auth";
import { auth } from "./config";

const GATEWAY_URL = String(import.meta.env.VITE_GOOGLE_DRIVE_GATEWAY_URL || "https://irpa-google-drive-gateway.irpa-governance.workers.dev").replace(/\/$/, "");

function requireGateway() {
  if (!GATEWAY_URL) {
    throw new Error("Google Drive gateway is not configured. Set VITE_GOOGLE_DRIVE_GATEWAY_URL.");
  }
  return GATEWAY_URL;
}

async function authHeaders() {
  if (!auth.currentUser) throw new Error("Authentication is required.");
  const token = await getIdToken(auth.currentUser);
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

async function gatewayPost(path, payload) {
  const response = await fetch(`${requireGateway()}${path}`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "Google Drive gateway request failed.");
  }
  return data;
}

export const storage = { provider: "Google Drive" };

export function ref(_storage, path) {
  return { path, fileId: null };
}

export async function uploadBytes(target, file, metadata = {}) {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
  }

  const result = await gatewayPost("/api/upload", {
    path: target.path,
    fileName: target.path.split("/").pop() || "IRPA-document.pdf",
    contentType: metadata.contentType || file.type || "application/pdf",
    fileSize: bytes.length,
    base64: btoa(binary),
    purpose: metadata.purpose || "Controlled Documents",
    folderId: metadata.folderId || null,
    ownerUid: metadata.ownerUid || null
  });

  target.fileId = result.fileId || null;
  if (!target.fileId) throw new Error("Google Drive did not return a file ID.");
  return { ref: target, metadata: result };
}

export function buildDocumentArchiveDestination({documentType="Governance Document",uploadedAt=null,archiveCategory="Administrative Documents",classification="Public"}={}){
  const type=String(documentType||"").trim();
  if(!type) throw new Error("Select the document type before uploading. The selected type determines the final document destination.");
  const timestamp=uploadedAt?new Date(uploadedAt):new Date();
  if(Number.isNaN(timestamp.getTime())) throw new Error("A valid document upload timestamp is required.");
  const year=String(timestamp.getUTCFullYear());
  const month=String(timestamp.getUTCMonth()+1).padStart(2,"0");
  const day=String(timestamp.getUTCDate()).padStart(2,"0");
  return {
    documentType:type,
    uploadedAt:timestamp.toISOString(),
    uploadYear:year,
    uploadMonth:month,
    uploadDay:day,
    destinationKey:[String(archiveCategory||"Administrative Documents").trim(),String(classification||"Public").trim(),type,year,month,day].filter(Boolean).join("/")
  };
}

export async function uploadControlledDocumentRouted({
  documentId,title,reference,documentType="Governance Document",archiveCategory="Administrative Documents",
  classification="Public",uploadedAt=null,file,contentType=null
}={}) {
  if (!file) throw new Error("A document file is required.");
  const resolvedContentType = String(contentType || file.type || "application/octet-stream").toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("Documents must not exceed 10 MB.");
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
  }
  const destination = buildDocumentArchiveDestination({documentType,uploadedAt,archiveCategory,classification});
  const result = await gatewayPost("/api/upload-controlled-document", {
    documentId,title,reference,documentType,archiveCategory,classification,
    uploadedAt:destination.uploadedAt,
    uploadYear:destination.uploadYear,
    uploadMonth:destination.uploadMonth,
    uploadDay:destination.uploadDay,
    destinationKey:destination.destinationKey,
    fileName:file.name,contentType:resolvedContentType,fileSize:bytes.length,base64:btoa(binary)
  });
  if (!result.categoryArchive?.folderId || !result.categoryArchive?.file?.fileId) {
    throw new Error("The controlled document was not returned with its primary archive route.");
  }
  return result;
}

export async function provisionDocumentArchive({documentId,title,reference,archiveCategory,classification}={}) {
  const result = await gatewayPost("/api/document-archive/provision", {
    documentId,title,reference,archiveCategory,classification
  });
  if (!result.folderId || !result.archiveUidLink) throw new Error("Google Drive did not return the document archive.");
  return result;
}

export async function ensureSignedDocumentArchive({documentId,title,reference,documentType,uploadedAt,archiveCategory,classification}={}) {
  const destination = buildDocumentArchiveDestination({documentType,uploadedAt,archiveCategory,classification});
  const result = await gatewayPost("/api/signed-document/archive", {
    documentId,title,reference,archiveCategory,classification,
    documentType:destination.documentType,
    uploadedAt:destination.uploadedAt,
    uploadYear:destination.uploadYear,
    uploadMonth:destination.uploadMonth,
    uploadDay:destination.uploadDay,
    destinationKey:destination.destinationKey
  });
  if (!result.folderId || !result.archiveUidLink) throw new Error("Google Drive did not return the signed-document archive.");
  return result;
}

export async function ensureDocumentArchiveFolder({documentId,title,reference,archiveCategory,classification}={}) {
  const result = await gatewayPost("/api/document-archive/folder", { documentId, title, reference, archiveCategory, classification });
  if (!result.folderId || !result.archiveUidLink) throw new Error("Google Drive did not return the signed-document archive.");
  return result;
}

export async function ensureSignatureWorkflowFolder(envelopeId) {
  const result = await gatewayPost("/api/signature-workflow/folder", { envelopeId });
  if (!result.folderId) throw new Error("Google Drive did not return the signature workflow folder.");
  return result;
}

export async function finalizeSignatureProfileArchives({envelopeId,signedBytes,finalHash,originalHash}={}) {
  if (!envelopeId || !signedBytes?.length || !finalHash) throw new Error("Completed signer archive data is incomplete.");
  const bytes = signedBytes instanceof Uint8Array ? signedBytes : new Uint8Array(signedBytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
  }
  const result = await gatewayPost("/api/signature-profile/finalize", {
    envelopeId,
    originalHash: originalHash || "",
    finalHash,
    fileSize: bytes.length,
    base64: btoa(binary)
  });
  if (!result.deliveries) throw new Error("Google Drive did not return completed signer archive deliveries.");
  return result;
}

export async function ensureSignatureProfileFolder(uid) {
  const email = uid === auth.currentUser?.uid ? (auth.currentUser?.email || "") : "";
  const result = await gatewayPost("/api/signature-profile/folder", { uid, email });
  if (!result.folderId) throw new Error("Google Drive did not return a signature profile folder ID.");
  return {
    ...result,
    signatureArchiveUidLink: `https://drive.google.com/drive/folders/${encodeURIComponent(result.folderId)}`,
    completedDocumentsFolderId: result.completedDocumentsFolderId || null,
    completedDocumentsFolderLink: result.completedDocumentsFolderLink || "",
    completedDocumentsFolderPath: result.completedDocumentsFolderPath || ""
  };
}

export async function getDownloadURL(target) {
  if (!target?.fileId) throw new Error("Google Drive file ID is missing.");
  return `drive://${target.fileId}`;
}

export async function downloadDriveBytes(fileId, documentId = null) {
  const result = await gatewayPost("/api/download", { fileId, documentId });
  const base64 = result.base64;
  if (!base64) throw new Error("Google Drive returned no file content.");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function deleteDriveFile(fileId, documentId = null) {
  if (!fileId) throw new Error("Google Drive file ID is required.");

  return gatewayPost("/api/delete", {
    fileId,
    documentId
  });
}

export async function startGoogleDriveAuthorization() {
  const result = await gatewayPost("/oauth/start", {});
  if (!result.authorizationUrl) throw new Error("Google Drive authorization URL was not returned.");
  window.location.assign(result.authorizationUrl);
}

if (typeof window !== "undefined" && !window.__irpaDriveFetchPatched) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    if (typeof url === "string" && url.startsWith("drive://")) {
      const bytes = await downloadDriveBytes(url.slice("drive://".length));
      return new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "application/pdf" }
      });
    }
    return nativeFetch(input, init);
  };
  window.__irpaDriveFetchPatched = true;
}

const MEETING_ARCHIVE_CATEGORIES = Object.freeze({
  GOVERNANCE: { label: "Governance Meetings", archiveCategory: "Governance Meeting Archive", classification: "Restricted" },
  ADMINISTRATIVE: { label: "Administrative Meetings", archiveCategory: "Administrative Meeting Archive", classification: "Restricted" },
  STAFF: { label: "Staff Meetings", archiveCategory: "Staff Meeting Archive", classification: "Internal" },
  GENERAL: { label: "General Meetings", archiveCategory: "General Meeting Archive", classification: "Internal" },
  OTHER: { label: "Other Meetings", archiveCategory: "Other Meeting Archive", classification: "Restricted" }
});

export async function provisionMeetingCategoryArchive({ meetingCategory, meetingId = null } = {}) {
  const category = String(meetingCategory || "OTHER").trim().toUpperCase();
  const policy = MEETING_ARCHIVE_CATEGORIES[category];
  if (!policy) throw new Error("Choose a valid meeting category before creating its Google Drive archive.");
  const result = await gatewayPost("/api/document-archive/provision", {
    documentId: "IRPA-MEETING-ARCHIVE-" + category,
    title: "IRPA " + policy.label + " Archive",
    reference: "IRPA-MEETING-ARCHIVE-" + category,
    archiveCategory: policy.archiveCategory,
    classification: policy.classification,
    meetingCategory: category,
    meetingId: meetingId || null,
    archivePurpose: "Authoritative meeting products for the " + policy.label + " category"
  });
  if (!result.folderId || !result.archiveUidLink) {
    throw new Error("Google Drive did not confirm creation of the " + policy.label + " archive.");
  }
  return {
    provider: "Google Drive",
    meetingCategory: category,
    archiveName: "IRPA " + policy.label + " Archive",
    folderId: result.folderId,
    folderUrl: result.archiveUidLink,
    archivePath: result.archivePath || policy.archiveCategory,
    classification: policy.classification
  };
}


export async function getMeetingCategoryArchive({ meetingCategory, meetingId } = {}) {
  const category = String(meetingCategory || "OTHER").trim().toUpperCase();
  const policy = MEETING_ARCHIVE_CATEGORIES[category];
  if (!policy) throw new Error("Choose a valid meeting category before opening its Google Drive archive.");
  if (!meetingId) throw new Error("A meeting ID is required to verify access to its category archive.");
  const result = await gatewayPost("/api/meeting-archive/get", { meetingCategory: category, meetingId });
  if (!result.folderId || !result.archiveUidLink) throw new Error("Google Drive did not return the authorised meeting category archive.");
  return {
    provider: "Google Drive",
    meetingCategory: category,
    archiveName: result.archiveName || ("IRPA " + policy.label + " Archive"),
    folderId: result.folderId,
    folderUrl: result.archiveUidLink,
    archivePath: result.archivePath || ("Meeting Archives/" + policy.label),
    classification: result.classification || policy.classification
  };
}

export async function uploadMeetingProductToDrive({
  meetingCategory, meetingId, meetingReference = "", recordId = "", recordType = "OTHER",
  title = "", fileName = "", content, contentType = "text/plain; charset=utf-8", ownerUid = null
} = {}) {
  if (!meetingId) throw new Error("A meeting ID is required to archive a meeting product.");
  if (content == null) throw new Error("Meeting product content is required.");
  const archive = await getMeetingCategoryArchive({ meetingCategory, meetingId });
  const bytes = content instanceof Uint8Array
    ? content
    : content instanceof Blob
      ? new Uint8Array(await content.arrayBuffer())
      : new TextEncoder().encode(String(content));
  if (!bytes.length) throw new Error("The meeting product is empty.");
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
  }
  const safe = value => String(value || "record").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "record";
  const extension = String(fileName).includes(".") ? String(fileName).split(".").pop() : "txt";
  const finalName = safe(fileName || (safe(recordType) + "-" + safe(recordId || title) + "." + extension));
  const path = [
    "meeting-archives", archive.meetingCategory, safe(meetingId),
    safe(recordType), safe(finalName)
  ].join("/");
  const uploaded = await gatewayPost("/api/upload", {
    path,
    fileName: finalName,
    contentType,
    fileSize: bytes.length,
    base64: btoa(binary),
    purpose: "Meeting Products",
    folderId: archive.folderId,
    ownerUid: ownerUid || auth.currentUser?.uid || null,
    documentId: recordId || null,
    meetingId,
    meetingReference,
    meetingCategory: archive.meetingCategory,
    recordType,
    title: title || finalName
  });
  if (!uploaded.fileId) throw new Error("Google Drive did not return a file ID for the meeting product.");
  return {
    provider: "Google Drive",
    meetingCategory: archive.meetingCategory,
    meetingId,
    meetingReference,
    recordId: recordId || null,
    recordType,
    title: title || finalName,
    fileName: finalName,
    fileId: uploaded.fileId,
    webViewLink: uploaded.webViewLink || "",
    folderId: archive.folderId,
    folderUrl: archive.folderUrl,
    archivePath: archive.archivePath,
    storagePath: path,
    contentType,
    fileSize: bytes.length,
    archivedAt: new Date().toISOString()
  };
}

export async function provisionAllMeetingCategoryArchives() {
  const categories = Object.keys(MEETING_ARCHIVE_CATEGORIES);
  const results = [];
  for (const meetingCategory of categories) {
    results.push(await provisionMeetingCategoryArchive({ meetingCategory }));
  }
  return results;
}
