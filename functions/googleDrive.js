const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
const { google } = require("googleapis");

const GOOGLE_DRIVE_CLIENT_ID = defineSecret("GOOGLE_DRIVE_CLIENT_ID");
const GOOGLE_DRIVE_CLIENT_SECRET = defineSecret("GOOGLE_DRIVE_CLIENT_SECRET");
const GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY = defineSecret("GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY");

const db = getFirestore();
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTHORIZED_DRIVE_EMAIL = "irpa2412@gmail.com";
const OAUTH_CALLBACK_URI = "https://us-central1-irpa-digital-board-governance.cloudfunctions.net/googleDriveOAuthCallback";
const PDF_MAX_BYTES = 10 * 1024 * 1024;
const ROOT_FOLDER_NAME = "IRPA Governance System";
const DOCUMENTS_FOLDER_NAME = "Controlled Documents";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function cleanName(value, fallback = "Document") {
  return String(value || fallback).trim().replace(/[\\/:*?"<>|]/g, "-").slice(0, 160) || fallback;
}

function hashState(state) {
  return crypto.createHash("sha256").update(state).digest("hex");
}

function encryptionKey() {
  const raw = String(GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY.value() || "").trim();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

function encryptRefreshToken(refreshToken) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: tag.toString("base64url")
  };
}

function decryptRefreshToken(record) {
  if (!record?.ciphertext || !record?.iv || !record?.tag) throw new Error("Google Drive refresh token is not configured.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

async function assertAdmin(uid) {
  if (!uid) throw new HttpsError("unauthenticated", "Authentication is required.");
  const snap = await db.collection("adminProfiles").doc(uid).get();
  if (!snap.exists || snap.data()?.active !== true) {
    throw new HttpsError("permission-denied", "Administrator authorization is required.");
  }
  return snap.data();
}

async function getDrive() {
  const stored = await db.collection("systemSecrets").doc("googleDriveOAuth").get();
  const refreshToken = decryptRefreshToken(stored.data());
  const oauth2 = new google.auth.OAuth2(
    GOOGLE_DRIVE_CLIENT_ID.value(),
    GOOGLE_DRIVE_CLIENT_SECRET.value(),
    OAUTH_CALLBACK_URI
  );
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth: oauth2 });
}

exports.startGoogleDriveAuthorization = onCall({
  region: "us-central1",
  secrets: [GOOGLE_DRIVE_CLIENT_ID]
}, async request => {
  const uid = request.auth?.uid;
  const admin = await assertAdmin(uid);
  const state = crypto.randomBytes(32).toString("base64url");
  const stateHash = hashState(state);
  const now = Date.now();

  await db.collection("googleDriveOAuthStates").doc(stateHash).set({
    stateHash,
    initiatedByUid: uid,
    initiatedByEmail: request.auth.token?.email || admin.email || null,
    targetDriveEmail: AUTHORIZED_DRIVE_EMAIL,
    createdAt: FieldValue.serverTimestamp(),
    expiresAtMs: now + OAUTH_STATE_TTL_MS,
    used: false
  });

  const oauth2 = new google.auth.OAuth2(
    GOOGLE_DRIVE_CLIENT_ID.value(),
    GOOGLE_DRIVE_CLIENT_SECRET.value(),
    OAUTH_CALLBACK_URI
  );
  const authorizationUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: [DRIVE_SCOPE],
    login_hint: AUTHORIZED_DRIVE_EMAIL,
    state
  });

  return { authorizationUrl, expiresInSeconds: Math.floor(OAUTH_STATE_TTL_MS / 1000) };
});

exports.googleDriveOAuthCallback = onRequest({
  region: "us-central1",
  secrets: [GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY]
}, async (req, res) => {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const error = String(req.query.error || "");

  if (error) {
    res.status(400).send("IRPA Google Drive authorization was cancelled or denied. You may close this window.");
    return;
  }
  if (!code || !state) {
    res.status(400).send("Missing OAuth authorization response.");
    return;
  }

  const stateRef = db.collection("googleDriveOAuthStates").doc(hashState(state));
  const stateSnap = await stateRef.get();
  const stateData = stateSnap.exists ? stateSnap.data() : null;
  if (!stateData || stateData.used === true || Number(stateData.expiresAtMs || 0) < Date.now()) {
    res.status(400).send("This one-time authorization link is invalid or has expired. Start the authorization again.");
    return;
  }

  await stateRef.update({ used: true, usedAt: FieldValue.serverTimestamp() });

  try {
    const oauth2 = new google.auth.OAuth2(
      GOOGLE_DRIVE_CLIENT_ID.value(),
      GOOGLE_DRIVE_CLIENT_SECRET.value(),
      OAUTH_CALLBACK_URI
    );
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token. Re-authorize with consent.");
    oauth2.setCredentials(tokens);

    const drive = google.drive({ version: "v3", auth: oauth2 });
    const about = await drive.about.get({ fields: "user(emailAddress,displayName)" });
    const authorizedEmail = String(about.data.user?.emailAddress || "").toLowerCase();
    if (authorizedEmail !== AUTHORIZED_DRIVE_EMAIL.toLowerCase()) {
      throw new Error(`The authorized Google account must be ${AUTHORIZED_DRIVE_EMAIL}.`);
    }

    const encrypted = encryptRefreshToken(tokens.refresh_token);
    await db.collection("systemSecrets").doc("googleDriveOAuth").set({
      storageProvider: "Google Drive",
      authorizedDriveEmail: AUTHORIZED_DRIVE_EMAIL,
      encryptedRefreshToken: encrypted,
      oauthScope: DRIVE_SCOPE,
      oauthClientId: GOOGLE_DRIVE_CLIENT_ID.value(),
      authorizedByUid: stateData.initiatedByUid,
      authorizedByEmail: stateData.initiatedByEmail || null,
      authorizedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    await db.collection("audit").add({
      action: "GOOGLE_DRIVE_AUTHORIZED",
      category: "SYSTEM_ADMINISTRATION",
      description: "Google Drive authorization completed for the IRPA governance document repository.",
      performedByUid: stateData.initiatedByUid,
      performedByEmail: stateData.initiatedByEmail || null,
      authorizedDriveEmail: AUTHORIZED_DRIVE_EMAIL,
      storageProvider: "Google Drive",
      oauthScope: DRIVE_SCOPE,
      createdAt: FieldValue.serverTimestamp()
    });

    res.status(200).send("IRPA Google Drive authorization completed successfully. The secure refresh token has been stored. You may close this window.");
  } catch (err) {
    console.error("Google Drive OAuth callback failed", err?.message || err);
    res.status(400).send("IRPA Google Drive authorization failed. Start the authorization again after correcting the Google account or OAuth configuration.");
  }
});

exports.uploadDocumentToGoogleDrive = onCall({
  region: "us-central1",
  timeoutSeconds: 300,
  memory: "1GiB",
  secrets: [GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY]
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
  if (buffer.length !== fileSize) throw new HttpsError("invalid-argument", "The uploaded PDF size could not be verified.");

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
        appProperties: { irpaGovernanceDocument: "true", uploadedByUid: uid, purpose }
      },
      media: { mimeType: contentType, body: buffer },
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

    return { success: true, document: { ...document, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } };
  } catch (error) {
    console.error("Google Drive document upload failed", error);
    throw new HttpsError("internal", "Google Drive upload failed. Check the IRPA Google Drive OAuth configuration.");
  }
});

exports.downloadDriveBinary = onCall({
  region: "us-central1",
  timeoutSeconds: 300,
  memory: "1GiB",
  secrets: [GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY]
}, async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Authentication is required.");
  const fileId = String(request.data?.fileId || "").trim();
  if (!fileId) throw new HttpsError("invalid-argument", "Google Drive file ID is required.");

  const adminSnap = await db.collection("adminProfiles").doc(uid).get();
  const isAdmin = adminSnap.exists && adminSnap.data()?.active === true;
  const docs = await db.collection("documents").where("driveFileId", "==", fileId).limit(1).get();
  if (!docs.empty && !isAdmin) {
    const doc = docs.docs[0].data();
    if (!Array.isArray(doc.authorizedUids) || !doc.authorizedUids.includes(uid)) {
      throw new HttpsError("permission-denied", "You are not authorized to retrieve this document.");
    }
  }
  if (docs.empty && !isAdmin) throw new HttpsError("permission-denied", "The requested Drive file is not registered as an authorized IRPA document.");

  try {
    const drive = await getDrive();
    const response = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    const bytes = Buffer.from(response.data);
    if (bytes.length > PDF_MAX_BYTES) throw new HttpsError("failed-precondition", "The Drive file exceeds the permitted document size.");
    return { success: true, fileId, base64: bytes.toString("base64") };
  } catch (error) {
    console.error("Google Drive download failed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Google Drive download failed.");
  }
});

async function findOrCreateFolder(drive, name, parentId = null) {
  const escapedName = name.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : "";
  const listed = await drive.files.list({ q: `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`, spaces: "drive", pageSize: 10, fields: "files(id,name,parents)" });
  const existing = listed.data.files?.[0];
  if (existing?.id) return existing.id;
  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [parentId] } : {}), appProperties: { irpaGovernanceFolder: "true" } },
    fields: "id,name,parents"
  });
  return created.data.id;
}
