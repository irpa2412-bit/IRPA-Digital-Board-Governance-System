import { getIdToken } from "firebase/auth";
import { auth } from "./config";

const GATEWAY_URL = String(import.meta.env.VITE_GATEWAY_ORIGIN || import.meta.env.VITE_GOOGLE_DRIVE_GATEWAY_URL || "https://irpa-google-drive-gateway.irpa-governance.workers.dev").trim().replace(/\/$/, "");

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
    ownerUid: metadata.ownerUid || null,
    documentId: metadata.documentId || metadata.customMetadata?.documentId || null,
    envelopeId: metadata.envelopeId || metadata.customMetadata?.envelopeId || null,
    signerUid: metadata.signerUid || metadata.customMetadata?.signerUid || null
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

export async function downloadControlledDocumentBytes(fileId, documentId) {
  if (!fileId || !documentId) throw new Error("A controlled document ID and Google Drive file ID are required.");
  const result = await gatewayPost("/api/download", { fileId, documentId });
  const base64 = result.base64;
  if (!base64) throw new Error("Google Drive returned no controlled document content.");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function downloadSignatureBytes(fileId, documentId = null, envelopeId = null) {
  if (!fileId) throw new Error("Google Drive file ID is required.");
  const result = await gatewayPost("/api/signature-file/download", { fileId, documentId, envelopeId });
  const base64 = result.base64;
  if (!base64) throw new Error("Google Drive returned no Signature Portal file content.");
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

export async function provisionCommunicationMediaArchive() {
  const result = await gatewayPost("/api/communication-media-archive/provision", {});
  if (!result.folderId || result.archiveName !== "Communication and Media Archive") {
    throw new Error("The IRPA Communication and Media Archive could not be verified.");
  }
  return result;
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
  const result = await gatewayPost("/api/meeting-archive/provision", {
    meetingCategory: category,
    meetingId: meetingId || null
  });
  if (!result.folderId || !result.archiveUidLink) {
    throw new Error("Google Drive did not confirm creation of the " + policy.label + " archive.");
  }
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
  title = "", fileName = "", content, contentType = "text/plain", ownerUid = null
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
  if (bytes.length > 60 * 1024 * 1024) throw new Error("Meeting products must not exceed 60 MB per file in this upload workflow.");
  const resolvedContentType = String(contentType || "application/octet-stream").split(";")[0].trim().toLowerCase();
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
    contentType: resolvedContentType,
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
    contentType: resolvedContentType,
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


async function sha256HexBytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

async function gatewayAuthenticatedRequest(path, {method="GET",body,contentType="application/json",signingToken=null}={}) {
  if (!auth.currentUser) throw new Error("Authentication is required.");
  const token = await getIdToken(auth.currentUser);
  const headers = {Authorization:"Bearer " + token};
  if (contentType) headers["Content-Type"] = contentType;
  if (signingToken) headers["x-signing-token"] = signingToken;
  return fetch(requireGateway() + path, {
    method,
    headers,
    ...(body !== undefined ? {body} : {})
  });
}

export async function createGatewaySignatureEnvelope({envelope,sourceBytes}={}) {
  if (!envelope?.id || !sourceBytes?.length) throw new Error("The Signature Portal envelope and controlled PDF are required for Gateway signing.");
  if (!auth.currentUser || envelope.ownerUid !== auth.currentUser.uid || envelope.senderUid !== auth.currentUser.uid) {
    throw new Error("Only the authenticated document owner can connect this signing workflow to the Gateway.");
  }
  const recipients = Array.isArray(envelope.recipients) ? envelope.recipients : [];
  const actionRecipients = recipients.filter(r => r?.uid && r?.actionRequired !== false && r?.optionalSigning !== true && !r?.accessOnly && !["View Only","Read Only","Information / FYI","Observer"].includes(String(r?.role || "").trim()));
  if (!actionRecipients.length) throw new Error("At least one authorized action signer is required.");
  const signerUids = new Set(actionRecipients.map(r => r.uid));
  if ((envelope.fields || []).some(field => field?.signerUid && !signerUids.has(field.signerUid))) {
    throw new Error("A signing field is assigned to a view-only or optional signer. Correct the field assignments before Gateway activation.");
  }
  const bytes = sourceBytes instanceof Uint8Array ? sourceBytes : new Uint8Array(sourceBytes);
  if (bytes.length < 8 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new Error("The Gateway signing source must be the controlled PDF.");
  }
  const documentId = ("DOC-" + String(envelope.id)).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64);
  const title = String(envelope.title || envelope.documentReference || "IRPA Signing Document").trim().slice(0, 180);
  const classification = ["Public","Internal","Restricted","Confidential"].includes(envelope.documentClassification) ? envelope.documentClassification : "Restricted";
  const archiveType = String(envelope.documentType || "").toLowerCase();
  const archiveKey = archiveType.includes("finance") ? "finance" :
    archiveType.includes("human") || archiveType.includes("personnel") ? "human-resources" :
    archiveType.includes("legal") || archiveType.includes("contract") ? "legal-contracts" :
    archiveType.includes("board") || archiveType.includes("governance") ? "board-governance" : "administrative-documents";
  const expectedHash = await sha256HexBytes(bytes);
  const existingResponse = await gatewayAuthenticatedRequest("/api/documents/" + encodeURIComponent(documentId) + "/pdf");
  if (existingResponse.ok) {
    const existingBytes = new Uint8Array(await existingResponse.arrayBuffer());
    if (await sha256HexBytes(existingBytes) !== expectedHash) {
      throw new Error("A Gateway document with this workflow reference exists but does not match the controlled PDF. Refusing to overwrite it.");
    }
  } else if (existingResponse.status === 404 || existingResponse.status === 403) {
    const form = new FormData();
    form.append("documentId", documentId);
    form.append("title", title);
    form.append("classification", classification);
    form.append("archives", archiveKey);
    form.append("file", new Blob([bytes], {type:"application/pdf"}), documentId + ".pdf");
    const uploadResponse = await gatewayAuthenticatedRequest("/api/documents", {method:"POST",body:form,contentType:null});
    const uploadData = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok || uploadData.ok === false) throw new Error(uploadData.error || "The controlled PDF could not be registered in the authenticated Gateway.");
    if (uploadData.documentId && uploadData.documentId !== documentId) throw new Error("The Gateway registered a different document ID than the signing workflow requested.");
  } else {
    const data = await existingResponse.json().catch(() => ({}));
    throw new Error(data.error || ("The Gateway could not verify the existing source document (HTTP " + existingResponse.status + ")."));
  }
  const ordered = [...actionRecipients].sort((a,b) => Number(a.routingOrder || 1) - Number(b.routingOrder || 1));
  const fields = (envelope.fields || []).filter(field => signerUids.has(field?.signerUid)).map(field => ({
    fieldId:field.fieldId,type:field.type,page:Number(field.page || 1),x:Number(field.x ?? 10),y:Number(field.y ?? 80),
    width:Number(field.width ?? 24),height:Number(field.height ?? 9),signerUid:field.signerUid,required:field.required === true,
    placeholder:field.placeholder || ""
  }));
  const payload = {
    externalReference:envelope.id,
    documentId,
    title,
    classification,
    archives:[archiveKey],
    signingMode:envelope.signingMode === "Parallel" ? "Parallel" : "Sequential",
    signers:ordered.map((recipient,index) => ({
      uid:recipient.uid,
      email:String(recipient.email || "").trim().toLowerCase(),
      name:String(recipient.name || recipient.displayName || recipient.email || "IRPA Signer").trim(),
      order:envelope.signingMode === "Parallel" ? 1 : index + 1
    })),
    fields
  };
  const response = await gatewayAuthenticatedRequest("/api/envelopes", {method:"POST",body:JSON.stringify(payload)});
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false || !result.envelopeId) {
    throw new Error(result.error || "The authenticated Gateway signing envelope was not created.");
  }
  return {gatewayEnvelopeId:result.envelopeId,gatewayDocumentId:documentId,gatewayOriginalHash:expectedHash,signingMode:payload.signingMode,gatewaySigningStatus:result.status || "Sent",existing:result.existing === true};
}

export async function voidGatewaySignatureEnvelope(envelopeId, reason="Signature Portal activation could not be committed") {
  if (!envelopeId) return {ok:true,skipped:true};
  const response = await gatewayAuthenticatedRequest("/api/envelopes/" + encodeURIComponent(envelopeId) + "/void", {
    method:"POST",body:JSON.stringify({reason})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.error || "Unable to void the unlinked Gateway signing envelope.");
  return result;
}

export async function fetchGatewaySigningStatus(token) {
  if (!token) throw new Error("A Gateway signing token is required.");
  const response = await gatewayAuthenticatedRequest("/api/sign/status", {signingToken:token});
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || "Unable to retrieve Gateway signing status.");
  return data;
}


export async function fetchGatewaySigningResource(path, token, {pdf=false}={}) {
  const response = await gatewayAuthenticatedRequest(path, {signingToken:token,contentType:pdf?null:"application/json"});
  if (!response.ok) {
    const data = pdf ? {} : await response.json().catch(() => ({}));
    throw new Error(data.error || ("Gateway signing request failed (HTTP " + response.status + ")."));
  }
  return pdf ? new Uint8Array(await response.arrayBuffer()) : response.json();
}

export async function submitGatewaySignature({token,signature,fieldValues={},manualAuthorityIdentification="",consent=true}={}) {
  if (!token) throw new Error("A Gateway signing token is required.");
  const response = await gatewayAuthenticatedRequest("/api/sign/submit", {
    method:"POST",
    body:JSON.stringify({token,signature,fieldValues,manualAuthorityIdentification,consent})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || "The Gateway did not accept the signing action.");
  return data;
}


export async function verifyGatewaySignedPdf({token,bytes}={}) {
  if (!token || !bytes?.length) throw new Error("A Gateway token and completed PDF are required for integrity verification.");
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const response = await gatewayAuthenticatedRequest("/api/sign/verify", {
    method:"POST",body,contentType:"application/pdf",signingToken:token
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false || result.verified !== true) throw new Error(result.error || "The completed PDF failed Gateway integrity verification.");
  return result;
}
