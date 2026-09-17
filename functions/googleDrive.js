const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { google } = require("googleapis");

const GOOGLE_DRIVE_CLIENT_ID = defineSecret("GOOGLE_DRIVE_CLIENT_ID");
const GOOGLE_DRIVE_CLIENT_SECRET = defineSecret("GOOGLE_DRIVE_CLIENT_SECRET");
const GOOGLE_DRIVE_REFRESH_TOKEN = defineSecret("GOOGLE_DRIVE_REFRESH_TOKEN");

const db = getFirestore();
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const PDF_MAX_BYTES = 10 * 1024 * 1024;
const ROOT_FOLDER_NAME = "IRPA Governance System";
const DOCUMENTS_FOLDER_NAME = "Controlled Documents";

function cleanName(value, fallback = "Document") {
  return String(value || fallback).trim().replace(/[\\/:*?"<>|]/g, "-").slice(0, 160) || fallback;
}

async function getDrive() {
  const oauth2 = new google.auth.OAuth2(
    GOOGLE_DRIVE_CLIENT_ID.value(),
    GOOGLE_DRIVE_CLIENT_SECRET.value()
  );
  oauth2.setCredentials({ refresh_token: GOOGLE_DRIVE_REFRESH_TOKEN.value() });
  return google.drive({ version: "v3", auth: oauth2 });
}

async function findOrCreateFolder(drive, name, parentId = null) {
  const escapedName = name.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : "";
  const listed = await drive.files.list({
    q: `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`,
    spaces: "drive",
    pageSize: 10,
    fields: "files(id,name,parents)"
  });
  const existing = listed.data.files?.[0];
  if (existing?.id) return existing.id;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
      appProperties: { irpaGovernanceFolder: "true" }
    },
    fields: "id,name,parents"
  });
  return created.data.id;
}

exports.uploadDocumentToGoogleDrive = onCall({
  region: "us-central1",
  timeoutSeconds: 300,
  memory: "1GiB",
  secrets: [GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN]
}, async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Authentication is required.");

  const data = request.data || {};
  const fileName = cleanName(data.fileName, "IRPA-Document.pdf");
  const title = cleanName(data.title, fileName.replace(/\.pdf$/i, ""));
  const purpose = cleanName(data.purpose, "Controlled Document");
  const contentType = String(data.contentType || "").toLowerCase();
  const fileSize = Number(data.fileSize || 0);
  const base64 = String(data.base64 || "");

  if (contentType !== "application/pdf") throw new HttpsError("invalid-argument", "Only PDF documents are accepted.");
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > PDF_MAX_BYTES) {
    throw new HttpsError("invalid-argument", "PDF must not exceed 10 MB.");
  }
  if (!base64) throw new HttpsError("invalid-argument", "The PDF data is missing.");

  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    throw new HttpsError("invalid-argument", "The PDF data is invalid.");
  }
  if (buffer.length !== fileSize) {
    throw new HttpsError("invalid-argument", "The uploaded PDF size could not be verified.");
  }

  try {
    const drive = await getDrive();
    const rootFolderId = await findOrCreateFolder(drive, ROOT_FOLDER_NAME);
    const documentsFolderId = await findOrCreateFolder(drive, DOCUMENTS_FOLDER_NAME, rootFolderId);
    const purposeFolderId = await findOrCreateFolder(drive, purpose, documentsFolderId);

    const uploaded = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [purposeFolderId],
        mimeType: contentType,
        description: `IRPA Digital Board Governance System | ${purpose}`,
        appProperties: {
          irpaGovernanceDocument: "true",
          uploadedByUid: uid,
          purpose
        }
      },
      media: {
        mimeType: contentType,
        body: buffer
      },
      fields: "id,name,mimeType,size,webViewLink,createdTime,parents"
    });

    const file = uploaded.data;
    const documentRef = db.collection("documents").doc();
    const document = {
      id: documentRef.id,
      title,
      documentType: "PDF",
      purpose,
      fileName: file.name || fileName,
      fileUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      driveFileId: file.id,
      driveFolderId: purposeFolderId,
      storageProvider: "Google Drive",
      fileSize,
      contentType,
      status: "Draft",
      classification: "Internal",
      authorizedUids: [uid],
      createdByUid: uid,
      createdByEmail: request.auth.token?.email || "",
      workflowStage: "Draft",
      controlledUpload: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };

    await documentRef.set(document);
    await db.collection("audit").add({
      action: "DOCUMENT_UPLOADED",
      category: "DOCUMENT_MANAGEMENT",
      description: `Controlled PDF uploaded to Google Drive: ${title}`,
      performedByUid: uid,
      performedByEmail: request.auth.token?.email || "",
      documentId: documentRef.id,
      driveFileId: file.id,
      storageProvider: "Google Drive",
      createdAt: FieldValue.serverTimestamp()
    });

    return {
      success: true,
      document: {
        ...document,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error("Google Drive document upload failed", error);
    throw new HttpsError("internal", "Google Drive upload failed. Check the IRPA Google Drive OAuth configuration.");
  }
});
