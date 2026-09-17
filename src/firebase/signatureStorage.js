import { httpsCallable } from "firebase/functions";
import { functions } from "./functions";

const uploadDriveBinary = httpsCallable(functions, "uploadDriveBinary");
const downloadDriveBinary = httpsCallable(functions, "downloadDriveBinary");

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
  const result = await uploadDriveBinary({
    path: target.path,
    fileName: target.path.split("/").pop() || "IRPA-document",
    contentType: metadata.contentType || file.type || "application/octet-stream",
    fileSize: bytes.length,
    base64: btoa(binary)
  });
  target.fileId = result.data?.fileId || null;
  if (!target.fileId) throw new Error("Google Drive did not return a file ID.");
  return { ref: target, metadata: result.data };
}

export async function getDownloadURL(target) {
  if (!target?.fileId) throw new Error("Google Drive file ID is missing.");
  return `drive://${target.fileId}`;
}

export async function downloadDriveBytes(fileId) {
  const result = await downloadDriveBinary({ fileId });
  const base64 = result.data?.base64;
  if (!base64) throw new Error("Google Drive returned no file content.");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
