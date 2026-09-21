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

export async function provisionDocumentArchive({documentId,title,reference,archiveCategory,classification}={}) {
  const result = await gatewayPost("/api/document-archive/provision", {
    documentId,title,reference,archiveCategory,classification
  });
  if (!result.folderId || !result.archiveUidLink) throw new Error("Google Drive did not return the document archive.");
  return result;
}

export async function ensureDocumentArchiveFolder({documentId,title,reference,archiveCategory,classification}={}) {
  const result = await gatewayPost("/api/document-archive/folder", { documentId, title, reference, archiveCategory, classification });
  if (!result.folderId || !result.archiveUidLink) throw new Error("Google Drive did not return the signed-document archive.");
  return result;
}

export async function ensureSignatureProfileFolder(uid) {
  const email = uid === auth.currentUser?.uid ? (auth.currentUser?.email || "") : "";
  const result = await gatewayPost("/api/signature-profile/folder", { uid, email });
  if (!result.folderId) throw new Error("Google Drive did not return a signature profile folder ID.");
  return result;
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
