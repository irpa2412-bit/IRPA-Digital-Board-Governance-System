const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { google } = require("googleapis");

const GOOGLE_DRIVE_CLIENT_ID = defineSecret("GOOGLE_DRIVE_CLIENT_ID");
const GOOGLE_DRIVE_CLIENT_SECRET = defineSecret("GOOGLE_DRIVE_CLIENT_SECRET");
const GOOGLE_DRIVE_REFRESH_TOKEN = defineSecret("GOOGLE_DRIVE_REFRESH_TOKEN");
const MAX_BYTES = 10 * 1024 * 1024;

async function getDrive() {
  const oauth2 = new google.auth.OAuth2(
    GOOGLE_DRIVE_CLIENT_ID.value(),
    GOOGLE_DRIVE_CLIENT_SECRET.value()
  );
  oauth2.setCredentials({ refresh_token: GOOGLE_DRIVE_REFRESH_TOKEN.value() });
  return google.drive({ version: "v3", auth: oauth2 });
}

async function findOrCreateFolder(drive, name, parentId = null) {
  const escaped = String(name).replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : "";
  const found = await drive.files.list({
    q: `name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`,
    spaces: "drive",
    pageSize: 10,
    fields: "files(id,name,parents)"
  });
  if (found.data.files?.[0]?.id) return found.data.files[0].id;
  const created = await drive.files.create({
    requestBody: {
      name: String(name).slice(0, 160),
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
      appProperties: { irpaGovernanceFolder: "true" }
    },
    fields: "id"
  });
  return created.data.id;
}

async function folderForPath(drive, path) {
  const parts = String(path || "IRPA/Document").split("/").filter(Boolean);
  parts.pop();
  let parentId = null;
  for (const part of parts.slice(0, 8)) parentId = await findOrCreateFolder(drive, part, parentId);
  return parentId;
}

exports.uploadDriveBinary = onCall({
  region: "us-central1",
  timeoutSeconds: 300,
  memory: "1GiB",
  secrets: [GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN]
}, async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Authentication is required.");
  const data = request.data || {};
  const fileSize = Number(data.fileSize || 0);
  const base64 = String(data.base64 || "");
  const fileName = String(data.fileName || "IRPA-file").replace(/[\\/:*?"<>|]/g, "-").slice(0, 180);
  const contentType = String(data.contentType || "application/octet-stream");
  if (!fileSize || fileSize > MAX_BYTES) throw new HttpsError("invalid-argument", "File must not exceed 10 MB.");
  if (!base64) throw new HttpsError("invalid-argument", "File content is missing.");

  const buffer = Buffer.from(base64, "base64");
  if (buffer.length !== fileSize) throw new HttpsError("invalid-argument", "File size verification failed.");

  try {
    const drive = await getDrive();
    const root = await findOrCreateFolder(drive, "IRPA Governance System");
    const requestedPath = String(data.path || "IRPA/Document");
    let parent = root;
    const pathParts = requestedPath.split("/").filter(Boolean);
    for (const part of pathParts.slice(0, -1).slice(0, 8)) parent = await findOrCreateFolder(drive, part, parent);

    const result = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [parent],
        mimeType: contentType,
        appProperties: {
          irpaSignatureAsset: "true",
          uploadedByUid: uid,
          sourcePath: requestedPath
        }
      },
      media: { mimeType: contentType, body: buffer },
      fields: "id,name,mimeType,size,createdTime,parents"
    });

    return { success: true, fileId: result.data.id, name: result.data.name, size: result.data.size || fileSize };
  } catch (error) {
    console.error("Google Drive binary upload failed", error);
    throw new HttpsError("internal", "Google Drive binary upload failed.");
  }
});

exports.downloadDriveBinary = onCall({
  region: "us-central1",
  timeoutSeconds: 300,
  memory: "1GiB",
  secrets: [GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN]
}, async request => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Authentication is required.");
  const fileId = String(request.data?.fileId || "");
  if (!fileId) throw new HttpsError("invalid-argument", "Google Drive file ID is required.");

  try {
    const drive = await getDrive();
    const metadata = await drive.files.get({ fileId, fields: "id,name,mimeType,size,appProperties" });
    if (metadata.data?.appProperties?.irpaSignatureAsset !== "true" && metadata.data?.appProperties?.irpaGovernanceDocument !== "true") {
      throw new HttpsError("permission-denied", "This Drive file is not an IRPA governance file.");
    }
    const size = Number(metadata.data.size || 0);
    if (size > MAX_BYTES) throw new HttpsError("failed-precondition", "The requested file exceeds the application download limit.");
    const response = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    return {
      success: true,
      fileId,
      fileName: metadata.data.name,
      contentType: metadata.data.mimeType,
      base64: Buffer.from(response.data).toString("base64")
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("Google Drive binary download failed", error);
    throw new HttpsError("internal", "Google Drive binary download failed.");
  }
});
