const FIREBASE_PROJECT_ID = "irpa-digital-board-governance";
const AUTHORIZED_DRIVE_EMAIL = "irpa2412@gmail.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["application/pdf","image/png","image/jpeg","image/webp"]);
const OAUTH_STATE_TTL = 600;
const SMTP_HOST = "mail.irpa.or.tz";
const SMTP_PORT = 465;
const SMTP_FROM = "info@irpa.or.tz";

let jwksCache = null;
let jwksFetchedAt = 0;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      if (url.pathname === "/health") {
        return json({
          ok: true,
          service: "IRPA Google Drive Gateway",
          storageProvider: "Google Drive"
        }, 200, corsHeaders(request));
      }

      if (url.pathname === "/oauth/start" && request.method === "POST") {
        return await startOAuth(request, env);
      }

      if (url.pathname === "/oauth/callback" && request.method === "GET") {
        return await oauthCallback(request, env);
      }

      // Normalize trailing slashes so portal upload/archive actions cannot be blocked by URL formatting.
      const pathname = url.pathname.replace(/\/+$/, "") || "/";

      if (pathname === "/api/upload" && request.method === "POST") {
        return await upload(request, env);
      }

      if (pathname === "/api/upload-controlled-document" && request.method === "POST") {
        return await uploadControlledDocument(request, env);
      }

      if (pathname === "/api/signature-profile/folder" && request.method === "POST") {
        return await ensureSignatureProfileFolder(request, env);
      }
      if (pathname === "/api/signature-profile/finalize" && request.method === "POST") {
        return await finalizeSignatureProfileArchives(request, env);
      }
      if (pathname === "/api/document-archive/folder" && request.method === "POST") {
        return await ensureDocumentArchiveFolder(request, env);
      }
      if (pathname === "/api/document-archive/provision" && request.method === "POST") {
        return await provisionDocumentArchive(request, env);
      }
      if (pathname === "/api/signed-document/archive" && request.method === "POST") {
        return await ensureSignedDocumentArchive(request, env);
      }
      if (pathname === "/api/signature-workflow/folder" && request.method === "POST") {
        return await ensureSignatureWorkflowFolder(request, env);
      }

      if (url.pathname === "/api/download" && request.method === "POST") {
        return await download(request, env);
      }

      if (url.pathname === "/api/delete" && request.method === "POST") {
        return await deleteDriveFile(request, env);
      }

      if (url.pathname === "/api/invitations/send" && request.method === "POST") {
        return await sendMemberInvitation(request, env);
      }

      if (url.pathname === "/api/induction/lookup" && request.method === "POST") {
        return await lookupInductionRegistration(request, env);
      }

      if (url.pathname === "/api/session/profile" && request.method === "POST") {
        return await getSessionProfile(request, env);
      }

      return json({ ok: false, error: "Not found." }, 404, corsHeaders(request));
    } catch (error) {
      console.error("Drive gateway error", error);

      const message = error?.message || "Drive gateway request failed.";
      const isAuthError =
        message === "Firebase authentication is required." ||
        message.startsWith("Invalid Firebase ID token") ||
        message.startsWith("Invalid Firebase token") ||
        message === "Firebase token is expired." ||
        message === "Firebase token signing key not found.";

      return json({
        ok: false,
        error: message
      }, isAuthError ? 401 : 500, corsHeaders(request));
    }
  }
};

async function startOAuth(request, env) {
  const claims = await authenticateFirebaseRequest(request);
  const admin = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
  if (!admin?.fields?.active?.booleanValue) {
    return json({ ok: false, error: "Administrator authorization is required." }, 403, corsHeaders(request));
  }

  const state = randomBase64Url(32);
  await env.DRIVE_KV.put(
    `oauth-state:${await sha256Hex(state)}`,
    JSON.stringify({
      uid: claims.user_id,
      email: claims.email || null,
      createdAt: Date.now(),
      expiresAt: Date.now() + OAUTH_STATE_TTL * 1000
    }),
    { expirationTtl: OAUTH_STATE_TTL }
  );

  const redirectUri = `${new URL(request.url).origin}/oauth/callback`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_DRIVE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    login_hint: AUTHORIZED_DRIVE_EMAIL,
    scope: DRIVE_SCOPE,
    state
  });

  return json({
    ok: true,
    authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }, 200, corsHeaders(request));
}

async function oauthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return html("IRPA Google Drive authorization was cancelled or denied. You may close this window.");
  if (!code || !state) return html("Missing Google OAuth authorization response.");

  const stateKey = `oauth-state:${await sha256Hex(state)}`;
  const stateRecord = await env.DRIVE_KV.get(stateKey, "json");
  if (!stateRecord || Date.now() > Number(stateRecord.expiresAt || 0)) {
    return html("This one-time authorization request is invalid or has expired. Start authorization again.");
  }
  await env.DRIVE_KV.delete(stateKey);

  const redirectUri = `${url.origin}/oauth/callback`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });

  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok || !tokens.access_token) {
    throw new Error(tokens.error_description || "Google OAuth token exchange failed.");
  }

  const about = await driveFetch(env, tokens.access_token, "/drive/v3/about?fields=user(emailAddress,displayName)");
  const email = String(about?.user?.emailAddress || "").toLowerCase();
  if (email !== AUTHORIZED_DRIVE_EMAIL.toLowerCase()) {
    return html(`Authorization rejected. The Google account must be ${AUTHORIZED_DRIVE_EMAIL}.`);
  }
  if (!tokens.refresh_token) {
    return html("Google did not return a refresh token. Start authorization again with consent.");
  }

  const encrypted = await encryptText(tokens.refresh_token, env.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY);
  await env.DRIVE_KV.put("google-drive-refresh-token", JSON.stringify({
    version: 1,
    authorizedEmail: AUTHORIZED_DRIVE_EMAIL,
    encrypted,
    authorizedByUid: stateRecord.uid,
    authorizedByEmail: stateRecord.email || null,
    authorizedAt: new Date().toISOString()
  }));

  return html("IRPA Google Drive authorization completed successfully. The refresh token has been stored securely. You may close this window.");
}

async function upload(request, env) {
  const claims = await authenticateFirebaseRequest(request);
  const data = await request.json();
  const fileName = cleanName(data.fileName || "IRPA-document");
  const contentType = String(data.contentType || "application/pdf").toLowerCase();
  const fileSize = Number(data.fileSize || 0);
  const base64 = String(data.base64 || "");
  const purpose = cleanName(data.purpose || "Controlled Documents");
  const requestedFolderId = String(data.folderId || "").trim();
  const ownerUid = String(data.ownerUid || claims.user_id).trim();

  if (purpose === "Signature Profile") {
    if (ownerUid !== claims.user_id) {
      return json({ ok: false, error: "A signature profile may only be uploaded by its owner." }, 403, corsHeaders(request));
    }
    const { memberRecord, employeeRecord } = await getInstitutionalProfileForUser(env, claims);
    const adminRecord = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
    if (!memberRecord && !employeeRecord && !adminRecord?.fields?.active?.booleanValue) {
      return json({ ok: false, error: "A registered IRPA member or employee profile is required before a Signature Profile asset can be uploaded." }, 403, corsHeaders(request));
    }
    if (!requestedFolderId) {
      return json({ ok: false, error: "A member signature folder is required." }, 400, corsHeaders(request));
    }
  } else if (purpose === "Signed Documents Archive" || purpose === "Documents Portal" || purpose === "Controlled Documents") {
    if (!requestedFolderId) return json({ ok:false, error:"A controlled document archive folder is required." },400,corsHeaders(request));
  } else if (requestedFolderId || data.ownerUid) {
    return json({ ok: false, error: "Folder parameters are restricted to authorized IRPA archive uploads." }, 400, corsHeaders(request));
  }

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return json({ ok: false, error: "Only PDF, PNG, JPEG or WEBP files are accepted." }, 400, corsHeaders(request));
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_BYTES) {
    return json({ ok: false, error: "Uploaded files must not exceed 10 MB." }, 400, corsHeaders(request));
  }

  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (bytes.length !== fileSize) {
    return json({ ok: false, error: "Uploaded PDF size could not be verified." }, 400, corsHeaders(request));
  }

  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, "IRPA Governance System");
  let purposeId;
  if (purpose === "Signature Profile" || purpose === "Signed Documents Archive" || purpose === "Documents Portal" || purpose === "Controlled Documents") {
    const folderMeta = await driveFetch(env, accessToken, `/drive/v3/files/${encodeURIComponent(requestedFolderId)}?fields=id,name,mimeType,description,trashed`);
    const folderDescription = parseDescription(folderMeta.description);
    if (folderMeta.mimeType !== "application/vnd.google-apps.folder" || folderMeta.trashed) {
      return json({ ok: false, error: "The requested IRPA archive folder is invalid." }, 409, corsHeaders(request));
    }
    if (purpose === "Signature Profile") {
      const isProfileRoot = folderDescription.irpaGovernanceSignatureFolder === true;
      const isCompletedArchive = folderDescription.irpaGovernanceSignatureProfileArchive === true;
      if ((!isProfileRoot && !isCompletedArchive) || folderDescription.ownerUid !== claims.user_id) {
        return json({ ok: false, error: "The requested signature archive does not belong to the authenticated member." }, 403, corsHeaders(request));
      }
    }
    if ((purpose === "Signed Documents Archive" || purpose === "Documents Portal" || purpose === "Controlled Documents") && folderDescription.irpaGovernanceArchive !== true) {
      return json({ ok: false, error: "The requested folder is not an IRPA controlled-document archive folder." }, 403, corsHeaders(request));
    }
    purposeId = requestedFolderId;
  } else {
    const documentsId = await findOrCreateFolder(env, accessToken, "Controlled Documents", rootId);
    purposeId = await findOrCreateFolder(env, accessToken, purpose, documentsId);
  }

  const metadata = {
    name: fileName,
    parents: [purposeId],
    mimeType: contentType,
    description: JSON.stringify({
      irpaGovernance: true,
      uploadedByUid: claims.user_id,
      purpose,
      ownerUid,
      driveFolderId: purpose === "Signature Profile" ? purposeId : null
    })
  };

  const boundary = `irpa-${crypto.randomUUID()}`;
  const body = buildMultipartBody(boundary, metadata, bytes, contentType);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,createdTime,parents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Google Drive upload failed.");

  return json({
    ok: true,
    fileId: result.id,
    fileName: result.name,
    fileSize: Number(result.size || fileSize),
    webViewLink: result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`,
    uploadedByUid: claims.user_id,
    storageProvider: "Google Drive"
  }, 200, corsHeaders(request));
}

async function uploadControlledDocument(request, env) {
  const claims = await authenticateFirebaseRequest(request);
  const { memberRecord, employeeRecord } = await getInstitutionalProfileForUser(env, claims);
  const adminRecord = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
  if (!memberRecord && !employeeRecord && !adminRecord?.fields?.active?.booleanValue) {
    return json({ok:false,error:"An active IRPA member, employee or administrator profile is required for controlled document upload."},403,corsHeaders(request));
  }
  const data = await request.json();
  const fileName = cleanName(data.fileName || "IRPA-governance-document.pdf");
  const contentType = String(data.contentType || "application/pdf").toLowerCase();
  const fileSize = Number(data.fileSize || 0);
  const base64 = String(data.base64 || "");
  const title = cleanName(data.title || fileName.replace(/\\.pdf$/i, ""));
  const reference = cleanName(data.reference || "");
  const documentId = cleanId(data.documentId || `IRPA-DOC-${crypto.randomUUID()}`);
  const documentType = cleanName(data.documentType || "Governance Document");
  const archiveCategory = String(data.archiveCategory || "Administrative Documents").trim();
  const classification = String(data.classification || "Public").trim();
  const governanceArchive = data.governanceArchive !== false && /governance/i.test(documentType);

  const allowedCategories = ["Finance Documents","Procurement Documents","Governance Documents","Administrative Documents"];
  const allowedClassifications = ["Public","Internal","Confidential","Restricted"];
  if (!allowedCategories.includes(archiveCategory)) return json({ok:false,error:"Invalid document archive category."},400,corsHeaders(request));
  if (!allowedClassifications.includes(classification)) return json({ok:false,error:"Invalid document access classification."},400,corsHeaders(request));
  if (contentType !== "application/pdf") return json({ok:false,error:"Only PDF documents are accepted for controlled-document routing."},400,corsHeaders(request));
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_BYTES) return json({ok:false,error:"Uploaded PDFs must not exceed 10 MB."},400,corsHeaders(request));

  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (bytes.length !== fileSize) return json({ok:false,error:"Uploaded PDF size could not be verified."},400,corsHeaders(request));

  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, "IRPA Governance System");

  const archiveRootId = await findOrCreateFolder(env, accessToken, "Document Archives", rootId, {
    irpaGovernanceArchive:true,
    purpose:"Controlled Document Archives"
  });
  const categoryId = await findOrCreateFolder(env, accessToken, archiveCategory, archiveRootId, {
    irpaGovernanceArchive:true,
    archiveCategory,
    purpose:"Controlled Document Category"
  });
  const classificationId = await findOrCreateFolder(env, accessToken, classification, categoryId, {
    irpaGovernanceArchive:true,
    archiveCategory,
    classification,
    purpose:"Controlled Document Classification"
  });
  const folderName = `IRPA-DOC-${documentId}`;
  const categoryFolderId = await findOrCreateFolder(env, accessToken, folderName, classificationId, {
    irpaGovernanceArchive:true,
    purpose:"Controlled Document",
    documentId,
    documentUid:documentId,
    documentTitle:title,
    documentReference:reference,
    archiveCategory,
    classification,
    publicAccess:classification==="Public"
  });
  if (classification==="Public") await ensureAnyoneReaderPermission(env,accessToken,categoryFolderId);

  let governanceRootId = null;
  let governanceClassificationId = null;
  let governanceFolderId = null;
  if (governanceArchive) {
    governanceRootId = await findOrCreateFolder(env, accessToken, "Board of Directors Governance Archive", rootId, {
      irpaGovernanceArchive:true,
      irpaBoardGovernanceArchive:true,
      purpose:"Board of Directors Governance Documents"
    });
    governanceClassificationId = await findOrCreateFolder(env, accessToken, classification, governanceRootId, {
      irpaGovernanceArchive:true,
      irpaBoardGovernanceArchive:true,
      classification,
      purpose:"Board of Directors Governance Classification"
    });
    governanceFolderId = await findOrCreateFolder(env, accessToken, folderName, governanceClassificationId, {
      irpaGovernanceArchive:true,
      irpaBoardGovernanceArchive:true,
      purpose:"Board of Directors Governance Document",
      documentId,
      documentUid:documentId,
      documentTitle:title,
      documentReference:reference,
      archiveCategory,
      classification
    });
    if (classification==="Public") await ensureAnyoneReaderPermission(env,accessToken,governanceFolderId);
  }

  const uploadToFolder = async (folderId, purposeLabel, archiveChannel) => {
    const metadata = {
      name:fileName,
      parents:[folderId],
      mimeType:contentType,
      description:JSON.stringify({
        irpaGovernance:true,
        irpaBoardGovernanceArchive:archiveChannel==="Board of Directors Governance Archive",
        uploadedByUid:claims.user_id,
        purpose:purposeLabel,
        documentId,
        documentUid:documentId,
        documentTitle:title,
        documentReference:reference,
        archiveCategory,
        classification,
        archiveChannel
      })
    };
    const boundary=`irpa-${crypto.randomUUID()}`;
    const body=buildMultipartBody(boundary,metadata,bytes,contentType);
    const response=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,createdTime,parents",{
      method:"POST",
      headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":`multipart/related; boundary=${boundary}`},
      body
    });
    const result=await response.json();
    if(!response.ok) throw new Error(result.error?.message || `Google Drive upload failed for ${archiveChannel}.`);
    return {
      fileId:result.id,
      fileName:result.name,
      fileSize:Number(result.size||fileSize),
      webViewLink:result.webViewLink||`https://drive.google.com/file/d/${result.id}/view`,
      folderId,
      archiveChannel
    };
  };

  const categoryFile=await uploadToFolder(categoryFolderId,"Controlled Documents",archiveCategory);
  const governanceFile=governanceFolderId
    ? await uploadToFolder(governanceFolderId,"Board of Directors Governance Documents","Board of Directors Governance Archive")
    : null;

  return json({
    ok:true,
    documentId,
    fileName,
    fileSize,
    storageProvider:"Google Drive",
    categoryArchive:{
      archiveRootId,
      categoryId,
      classificationId,
      folderId:categoryFolderId,
      archiveCategory,
      classification,
      archivePath:`IRPA Governance System/Document Archives/${archiveCategory}/${classification}/${folderName}`,
      archiveUidLink:`https://drive.google.com/drive/folders/${encodeURIComponent(categoryFolderId)}`,
      file:categoryFile
    },
    governanceArchive:governanceFile ? {
      rootId:governanceRootId,
      classificationId:governanceClassificationId,
      folderId:governanceFolderId,
      archivePath:`IRPA Governance System/Board of Directors Governance Archive/${classification}/${folderName}`,
      archiveUidLink:`https://drive.google.com/drive/folders/${encodeURIComponent(governanceFolderId)}`,
      file:governanceFile
    } : null
  },200,corsHeaders(request));
}

async function download(request, env) {
  const claims = await authenticateFirebaseRequest(request);
  const data = await request.json();
  const fileId = String(data.fileId || "").trim();
  if (!fileId) return json({ ok: false, error: "Google Drive file ID is required." }, 400, corsHeaders(request));

  if (data.documentId) {
    const document = await getFirestoreDocument(env, `documents/${cleanId(data.documentId)}`, claims.token);
    const fields = document?.fields || {};
    const authorizedUids = firestoreStringArray(fields.authorizedUids);
    const admin = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
    const isAdmin = Boolean(admin?.fields?.active?.booleanValue);
    if (!isAdmin && !authorizedUids.includes(claims.user_id)) {
      return json({ ok: false, error: "You are not authorized to retrieve this document." }, 403, corsHeaders(request));
    }
  }

  const accessToken = await getDriveAccessToken(env);
  const metadata = await driveFetch(env, accessToken, `/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,description`);
  const description = parseDescription(metadata.description);
  if (!description?.irpaGovernance) {
    return json({ ok: false, error: "The requested file is not an IRPA governance document." }, 403, corsHeaders(request));
  }
  if (description.purpose === "Signature Profile" && description.ownerUid !== claims.user_id) {
    return json({ ok: false, error: "This signature asset is restricted to its owner." }, 403, corsHeaders(request));
  }

  const size = Number(metadata.size || 0);
  if (size > MAX_BYTES) return json({ ok: false, error: "The requested file exceeds the 10 MB limit." }, 400, corsHeaders(request));

  const media = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!media.ok) throw new Error("Google Drive download failed.");

  const buffer = new Uint8Array(await media.arrayBuffer());
  return json({
    ok: true,
    fileId,
    fileName: metadata.name,
    contentType: metadata.mimeType,
    base64: uint8ToBase64(buffer)
  }, 200, corsHeaders(request));
}



async function finalizeSignatureProfileArchives(request, env) {
  const claims = await authenticateFirebaseRequest(request);
  const data = await request.json();
  const envelopeId = cleanId(data.envelopeId || "");
  const finalHash = String(data.finalHash || "").trim();
  const originalHash = String(data.originalHash || "").trim();
  const base64 = String(data.base64 || "");
  const fileSize = Number(data.fileSize || 0);
  if (!envelopeId || !finalHash || !base64 || !Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_BYTES) {
    return json({ok:false,error:"Completed signature archive data is incomplete."},400,corsHeaders(request));
  }

  const envelope = await getFirestoreDocument(env, `signatureEnvelopes/${envelopeId}`, claims.token);
  const fields = envelope?.fields || {};
  const status = fields.status?.stringValue || "";
  const lastSignedByUid = fields.lastSignedByUid?.stringValue || "";
  if (status !== "Completed" || lastSignedByUid !== claims.user_id) {
    return json({ok:false,error:"Final signer authorization is required before distributing the completed document to signer archives."},403,corsHeaders(request));
  }

  const recipients = firestoreMapArray(fields.recipients);
  const actionRecipients = recipients.filter(r => !r.accessOnly && r.uid);
  if (!actionRecipients.length) {
    return json({ok:true,envelopeId,deliveries:{}},200,corsHeaders(request));
  }

  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (bytes.length !== fileSize) return json({ok:false,error:"Completed signed PDF size could not be verified."},400,corsHeaders(request));

  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, "IRPA Governance System");
  const signaturesId = await findOrCreateFolder(env, accessToken, "Signature Profiles", rootId);
  const deliveries = {};

  for (const recipient of actionRecipients) {
    const uid = cleanId(recipient.uid);
    const email = String(recipient.email || "").trim().toLowerCase();
    if (!uid) continue;
    const folderName = `IRPA-SIGNATURE-${uid}`;
    const folderId = await findOrCreateFolder(env, accessToken, folderName, signaturesId, {
      irpaGovernanceSignatureFolder: true,
      ownerUid: uid,
      folderUid: uid,
      purpose: "Member Signature Profile"
    });
    if (email) await ensureSignatureFolderPermission(env, accessToken, folderId, email);
    const completedFolderId = await findOrCreateFolder(env, accessToken, "Completed Signed Documents", folderId, {
      irpaGovernanceSignatureProfileArchive: true,
      ownerUid: uid,
      folderUid: uid,
      purpose: "Completed Documents Signed by Profile Owner"
    });
    const fileName = `completed-${envelopeId}-${finalHash}.pdf`;
    const metadata = {
      name: fileName,
      parents: [completedFolderId],
      mimeType: "application/pdf",
      description: JSON.stringify({
        irpaGovernance: true,
        uploadedByUid: claims.user_id,
        purpose: "Signature Profile",
        ownerUid: uid,
        envelopeId,
        signerUid: uid,
        finalSignerUid: claims.user_id,
        originalHash,
        finalHash,
        archiveProtocol: "IRPA-SIGNER-COPY-V2",
        archiveState: "Final Completed Document"
      })
    };
    const boundary = `irpa-${crypto.randomUUID()}`;
    const body = buildMultipartBody(boundary, metadata, bytes, "application/pdf");
    const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,createdTime,parents", {
      method:"POST",
      headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":`multipart/related; boundary=${boundary}`},
      body
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || `Unable to archive completed document for signer ${uid}.`);
    deliveries[uid] = {
      fileId: result.id,
      fileName: result.name,
      webViewLink: result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`,
      folderId: completedFolderId,
      folderLink: `https://drive.google.com/drive/folders/${encodeURIComponent(completedFolderId)}`,
      myDocumentsPortal: "My Documents",
      myDocumentsPortalPath: `My Documents/Completed Signed Documents/${fileName}`,
      finalHash,
      archiveProtocol: "IRPA-SIGNER-COPY-V2"
    };
  }

  return json({ok:true,envelopeId,deliveries},200,corsHeaders(request));
}

async function ensureSignatureProfileFolder(request, env) {
  const claims = await authenticateFirebaseRequest(request);
  const { memberRecord, employeeRecord } = await getInstitutionalProfileForUser(env, claims);
  const adminRecord = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
  const isSignatureProfileOwner = Boolean(memberRecord) || Boolean(employeeRecord);
  const isAdmin = Boolean(adminRecord?.fields?.active?.booleanValue);
  if (!isSignatureProfileOwner && !isAdmin) {
    return json({ ok: false, error: "A registered IRPA member or employee profile is required before a Signature Profile archive can be created." }, 403, corsHeaders(request));
  }

  const data = await request.json();
  const requestedUid = cleanId(data.uid || claims.user_id);
  const requestedEmail = String(data.email || claims.email || "").trim().toLowerCase();
  if (!requestedUid) return json({ ok: false, error: "Member UID is required." }, 400, corsHeaders(request));
  if (requestedUid === claims.user_id && requestedEmail && requestedEmail !== String(claims.email || "").trim().toLowerCase()) {
    return json({ ok: false, error: "The signature-folder email does not match the authenticated account." }, 403, corsHeaders(request));
  }

  const admin = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
  const signatureProfileAdmin = Boolean(admin?.fields?.active?.booleanValue);
  if (!signatureProfileAdmin && requestedUid !== claims.user_id) {
    return json({ ok: false, error: "You may only provision your own signature folder." }, 403, corsHeaders(request));
  }

  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, "IRPA Governance System");
  const signaturesId = await findOrCreateFolder(env, accessToken, "Signature Profiles", rootId);
  const folderName = `IRPA-SIGNATURE-${requestedUid}`;
  const folderId = await findOrCreateFolder(env, accessToken, folderName, signaturesId, {
    irpaGovernanceSignatureFolder: true,
    ownerUid: requestedUid,
    folderUid: requestedUid,
    purpose: "Member Signature Profile"
  });

  // Prescribed personal archive for every completed signing action by this profile.
  // It is a child of the established Signature Profile and is never a loose folder.
  const completedDocumentsFolderId = await findOrCreateFolder(
    env,
    accessToken,
    "Completed Signed Documents",
    folderId,
    {
      irpaGovernanceSignatureProfileArchive: true,
      ownerUid: requestedUid,
      folderUid: requestedUid,
      purpose: "Completed Documents Signed by Profile Owner"
    }
  );

  let folderShared = false;
  if (requestedEmail) {
    folderShared = await ensureSignatureFolderPermission(env, accessToken, folderId, requestedEmail);
  }

  return json({
    ok: true,
    uid: requestedUid,
    folderId,
    folderName,
    parentFolderId: signaturesId,
    completedDocumentsFolderId,
    completedDocumentsFolderName: "Completed Signed Documents",
    completedDocumentsFolderPath: `IRPA Governance System/Signature Profiles/${folderName}/Completed Signed Documents`,
    completedDocumentsFolderLink: `https://drive.google.com/drive/folders/${completedDocumentsFolderId}`,
    folderShared,
    path: `IRPA Governance System/Signature Profiles/${folderName}`
  }, 200, corsHeaders(request));
}

async function ensureDocumentArchiveFolder(request, env) {
  const claims = await authenticateFirebaseRequest(request);
  const data = await request.json();
  const documentId = cleanId(data.documentId || "");
  if (!documentId) return json({ok:false,error:"Document UID is required."},400,corsHeaders(request));

  const classification = String(data.classification || "Public").trim();
  const archiveCategory = String(data.archiveCategory || "Administrative Documents").trim();
  const allowedCategories = ["Finance Documents","Procurement Documents","Governance Documents","Administrative Documents"];
  const allowedClassifications = ["Public","Internal","Confidential","Restricted"];
  if (!allowedCategories.includes(archiveCategory)) return json({ok:false,error:"Invalid document archive category."},400,corsHeaders(request));
  if (!allowedClassifications.includes(classification)) return json({ok:false,error:"Invalid document access classification."},400,corsHeaders(request));

  const title = cleanName(data.title || documentId);
  const reference = cleanName(data.reference || documentId);
  const isPublic = classification === "Public";
  const accessToken = await getDriveAccessToken(env);

  const rootId = await findOrCreateFolder(env, accessToken, "IRPA Governance System");
  const archiveRootId = await findOrCreateFolder(env, accessToken, "Document Archives", rootId, {
    irpaGovernanceArchive:true,
    purpose:"Controlled Document Archives"
  });
  const categoryId = await findOrCreateFolder(env, accessToken, archiveCategory, archiveRootId, {
    irpaGovernanceArchive:true,
    archiveCategory,
    purpose:"Controlled Document Category"
  });
  const classificationId = await findOrCreateFolder(env, accessToken, classification, categoryId, {
    irpaGovernanceArchive:true,
    archiveCategory,
    classification,
    purpose:"Controlled Document Classification"
  });
  const folderName = `IRPA-DOC-${documentId}`;
  const folderId = await findOrCreateFolder(env, accessToken, folderName, classificationId, {
    irpaGovernanceArchive:true,
    purpose:"Controlled Document",
    documentId,
    documentUid:documentId,
    documentTitle:title,
    documentReference:reference,
    archiveCategory,
    classification,
    publicAccess:isPublic
  });

  if (isPublic) await ensureAnyoneReaderPermission(env, accessToken, folderId);

  return json({
    ok:true,
    documentUid:documentId,
    folderId,
    folderName,
    archiveRootId,
    categoryId,
    classificationId,
    archiveCategory,
    classification,
    archivePath:`IRPA Governance System/Document Archives/${archiveCategory}/${classification}/${folderName}`,
    archiveUidLink:`https://drive.google.com/drive/folders/${folderId}`,
    archiveCategoryUidLink:`https://drive.google.com/drive/folders/${categoryId}`,
    archiveAccess:isPublic?"Public":"Restricted",
    createdByUid:claims.user_id
  },200,corsHeaders(request));
}

async function provisionDocumentArchive(request, env) {
  const claims = await authenticateFirebaseRequest(request);
  const data = await request.json();
  const documentId = cleanId(data.documentId || "");
  if (!documentId) return json({ok:false,error:"Document ID is required."},400,corsHeaders(request));
  const document = await getFirestoreDocument(env, `documents/${documentId}`, claims.token);
  if (!document) return json({ok:false,error:"Document registry record was not found."},404,corsHeaders(request));
  const archive = await ensureDocumentArchiveFolder(new Request(request.url,{method:"POST",headers:request.headers,body:JSON.stringify(data)}),env);
  const fileId = document.fields?.fileId?.stringValue || "";
  let archivedFileId = "";
  let archivedFileLink = "";
  if (fileId) {
    const accessToken = await getDriveAccessToken(env);
    const copied = await driveFetch(env,accessToken,`/drive/v3/files/${encodeURIComponent(fileId)}/copy?supportsAllDrives=true`,{
      method:"POST",
      body:JSON.stringify({name:cleanName(document.fields?.fileName?.stringValue||document.fields?.title?.stringValue||"Controlled Document.pdf"),parents:[archive.folderId]})
    });
    archivedFileId=copied.id||"";
    archivedFileLink=archivedFileId?`https://drive.google.com/file/d/${archivedFileId}/view`:"";
    if(archive.archiveAccess==="Public"&&archivedFileId) await ensureAnyoneReaderPermission(env,accessToken,archivedFileId);
  }
  return json({...archive,archivedFileId,archivedFileLink},200,corsHeaders(request));
}

async function ensureAnyoneReaderPermission(env, accessToken, folderId) {
  const existing = await driveFetch(
    env,
    accessToken,
    `/drive/v3/files/${encodeURIComponent(folderId)}/permissions?fields=permissions(id,type,role)&pageSize=100`
  );
  if ((existing.permissions || []).some(p => p.type === "anyone" && ["reader","commenter","writer"].includes(p.role))) {
    return true;
  }
  await driveFetch(env, accessToken, `/drive/v3/files/${encodeURIComponent(folderId)}/permissions?sendNotificationEmail=false`, {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({type:"anyone",role:"reader"})
  });
  return true;
}

async function ensureSignedDocumentArchive(request, env) {
  const claims = await authenticateFirebaseRequest(request);
  const data = await request.json();
  const documentId = cleanId(data.documentId || "");
  if (!documentId) return json({ok:false,error:"Document UID is required."},400,corsHeaders(request));
  const document = await getFirestoreDocument(env, `documents/${documentId}`, claims.token);
  if (!document) return json({ok:false,error:"Document registry record was not found."},404,corsHeaders(request));
  const fields = document.fields || {};
  const classification = String(data.classification || fields.classification?.stringValue || "Public").trim();
  const archiveCategory = String(data.archiveCategory || fields.archiveCategory?.stringValue || "Administrative Documents").trim();
  const title = cleanName(data.title || fields.title?.stringValue || documentId);
  const reference = cleanName(data.reference || fields.reference?.stringValue || documentId);
  const documentType = String(fields.documentType?.stringValue || data.documentType || "Administrative Document").trim();
  const governanceArchive = /governance/i.test(documentType);
  const allowedCategories = ["Finance Documents","Procurement Documents","Governance Documents","Administrative Documents"];
  const allowedClassifications = ["Public","Internal","Confidential","Restricted"];
  if (!allowedCategories.includes(archiveCategory)) return json({ok:false,error:"Invalid document archive category."},400,corsHeaders(request));
  if (!allowedClassifications.includes(classification)) return json({ok:false,error:"Invalid document access classification."},400,corsHeaders(request));

  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, "IRPA Governance System");
  const signedRootId = await findOrCreateFolder(env, accessToken, "Signed Documents Archive", rootId, {
    irpaGovernanceArchive:true,
    purpose:"Signed Documents Archive"
  });
  const categoryId = await findOrCreateFolder(env, accessToken, archiveCategory, signedRootId, {
    irpaGovernanceArchive:true,
    archiveCategory,
    purpose:"Signed Document Category"
  });
  const classificationId = await findOrCreateFolder(env, accessToken, classification, categoryId, {
    irpaGovernanceArchive:true,
    archiveCategory,
    classification,
    purpose:"Signed Document Classification"
  });
  const folderName = `IRPA-DOC-${documentId}`;
  const folderId = await findOrCreateFolder(env, accessToken, folderName, classificationId, {
    irpaGovernanceArchive:true,
    purpose:"Signed Document",
    documentId,
    documentUid:documentId,
    documentTitle:title,
    documentReference:reference,
    archiveCategory,
    classification,
    publicAccess:classification==="Public"
  });
  if (classification==="Public") await ensureAnyoneReaderPermission(env,accessToken,folderId);

  let governanceRootId=null;
  let governanceClassificationId=null;
  let governanceFolderId=null;
  if (governanceArchive) {
    governanceRootId = await findOrCreateFolder(env, accessToken, "Board of Directors Governance Archive", rootId, {
      irpaGovernanceArchive:true,
      irpaBoardGovernanceArchive:true,
      purpose:"Board of Directors Governance Documents"
    });
    governanceClassificationId = await findOrCreateFolder(env, accessToken, classification, governanceRootId, {
      irpaGovernanceArchive:true,
      irpaBoardGovernanceArchive:true,
      classification,
      purpose:"Board of Directors Governance Signed Documents"
    });
    governanceFolderId = await findOrCreateFolder(env, accessToken, folderName, governanceClassificationId, {
      irpaGovernanceArchive:true,
      irpaBoardGovernanceArchive:true,
      purpose:"Board of Directors Governance Signed Document",
      documentId,
      documentUid:documentId,
      documentTitle:title,
      documentReference:reference,
      archiveCategory,
      classification
    });
    if (classification==="Public") await ensureAnyoneReaderPermission(env,accessToken,governanceFolderId);
  }

  return json({
    ok:true,
    documentUid:documentId,
    folderId,
    archiveRootId:signedRootId,
    categoryId,
    classificationId,
    archiveCategory,
    classification,
    archivePath:`IRPA Governance System/Signed Documents Archive/${archiveCategory}/${classification}/${folderName}`,
    archiveUidLink:`https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`,
    archiveCategoryUidLink:`https://drive.google.com/drive/folders/${encodeURIComponent(categoryId)}`,
    archiveAccess:classification==="Public"?"Public":"Restricted",
    governanceArchive:governanceFolderId ? {
      rootId:governanceRootId,
      classificationId:governanceClassificationId,
      folderId:governanceFolderId,
      archivePath:`IRPA Governance System/Board of Directors Governance Archive/${classification}/Signed Documents/${folderName}`,
      archiveUidLink:`https://drive.google.com/drive/folders/${encodeURIComponent(governanceFolderId)}`
    } : null
  },200,corsHeaders(request));
}

async function ensureSignatureWorkflowFolder(request, env) {
  const claims = await authenticateFirebaseRequest(request);
  const data = await request.json();
  const envelopeId = cleanId(data.envelopeId || "");
  if (!envelopeId) return json({ok:false,error:"Signature workflow ID is required."},400,corsHeaders(request));
  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, "IRPA Governance System");
  const workflowsId = await findOrCreateFolder(env, accessToken, "Signature Workflows", rootId, {
    irpaGovernanceSignatureWorkflow:true,
    purpose:"Signature Workflow Working Files"
  });
  const folderName = `IRPA-WORKFLOW-${envelopeId}`;
  const folderId = await findOrCreateFolder(env, accessToken, folderName, workflowsId, {
    irpaGovernanceSignatureWorkflow:true,
    envelopeId,
    ownerUid:claims.user_id,
    purpose:"Signature Workflow Working File"
  });
  return json({ok:true,envelopeId,folderId,folderName,archiveAccess:"Restricted",path:`IRPA Governance System/Signature Workflows/${folderName}`},200,corsHeaders(request));
}

async function getSessionProfile(request, env) {
  const claims = await authenticateFirebaseRequest(request);
  const [adminDoc, memberDoc, employeeDoc] = await Promise.all([
    getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token),
    getFirestoreDocument(env, `members/${claims.user_id}`, claims.token),
    getFirestoreDocument(env, `employees/${claims.user_id}`, claims.token)
  ]);
  const admin = firestoreDocumentToPlain(adminDoc);
  const member = firestoreDocumentToPlain(memberDoc);
  const employee = firestoreDocumentToPlain(employeeDoc);
  return json({
    ok:true,
    uid:claims.user_id,
    email:claims.email || member?.email || employee?.email || "",
    admin: admin && admin.active === true ? admin : null,
    member: member && member.status === "Active" ? member : null,
    employee: employee || null
  },200,corsHeaders(request));
}

async function lookupInductionRegistration(request, env) {
  const claims = await authenticateFirebaseRequest(request);
  const data = await request.json();
  const enteredName = String(data.fullName || "").trim();
  if (enteredName.length < 2) return json({ok:true,matched:false,reason:"Enter at least 2 characters."},200,corsHeaders(request));

  const normalize = value => String(value || "").trim().toLowerCase().replace(/\\s+/g," ");
  const target = normalize(enteredName);
  const member = await getFirestoreDocument(env, `members/${cleanId(claims.user_id)}`, claims.token);
  const employee = await getFirestoreDocument(env, `employees/${cleanId(claims.user_id)}`, claims.token);
  const invitationRows = await queryFirestoreByEmail(env, "invitations", "email", claims.email || "", claims.token);

  const memberFields = member?.fields || {};
  const employeeFields = employee?.fields || {};
  const invitationRecords = invitationRows.map(row => row.document).filter(Boolean);
  const invitation = invitationRecords
    .map(doc => firestoreDocumentToPlain(doc))
    .filter(x => normalize(x.email) === normalize(claims.email) && normalize(x.name) === target)
    .sort((a,b) => Number(b.updatedAt?.timestampValue ? Date.parse(b.updatedAt.timestampValue) : 0) - Number(a.updatedAt?.timestampValue ? Date.parse(a.updatedAt.timestampValue) : 0))[0] || null;

  const memberPlain = firestoreDocumentToPlain(member);
  const employeePlain = firestoreDocumentToPlain(employee);
  const ownNames = [employeePlain?.name, memberPlain?.name].filter(Boolean).map(normalize);
  const nameMatchesOwnRecord = ownNames.includes(target);
  if (!nameMatchesOwnRecord && !invitation) {
    return json({ok:true,matched:false,reason:"No registration record matching the entered full name was found for the authenticated IRPA account."},200,corsHeaders(request));
  }

  const number = employeeFields.employeeNumber?.stringValue || memberFields.memberNumber?.stringValue || "";
  const merged = {
    fullName: employeePlain?.name || memberPlain?.name || invitation?.name || enteredName,
    email: claims.email || employeePlain?.email || memberPlain?.email || invitation?.email || "",
    registrationNumber: number,
    employeeNumber: employeeFields.employeeNumber?.stringValue || "",
    memberNumber: memberFields.memberNumber?.stringValue || "",
    role: employeePlain?.role || memberPlain?.role || invitation?.role || "",
    department: employeePlain?.department || memberPlain?.department || invitation?.department || "",
    unit: employeePlain?.unit || memberPlain?.unit || invitation?.unit || "",
    memberType: memberPlain?.memberType || invitation?.memberType || "",
    employmentType: employeePlain?.employmentType || invitation?.employmentType || "",
    employmentStatus: employeePlain?.status || employeePlain?.employmentStatus || "",
    memberStatus: memberPlain?.status || "",
    invitationStatus: invitation?.status || "",
    invitationId: invitation?.id || "",
    sources: [
      memberPlain ? "Members Registration" : null,
      employeePlain ? "Employees & Personnel Registration" : null,
      invitation ? "Member & Personnel Invitations" : null
    ].filter(Boolean)
  };
  return json({ok:true,matched:true,registration:merged},200,corsHeaders(request));
}

async function sendRegistrationNumber(request, env) {
  const claims = await authenticateFirebaseRequest(request);
  const data = await request.json();
  const uid = cleanId(data.uid || claims.user_id);
  if (uid !== claims.user_id) return json({ok:false,error:"Registration-number email may only be requested for the authenticated account."},403,corsHeaders(request));
  const member = await getFirestoreDocument(env, `members/${uid}`, claims.token);
  const employee = await getFirestoreDocument(env, `employees/${uid}`, claims.token);
  const memberFields = member?.fields || {};
  const employeeFields = employee?.fields || {};
  const number = employeeFields.employeeNumber?.stringValue || memberFields.memberNumber?.stringValue || "";
  const email = String(claims.email || employeeFields.email?.stringValue || memberFields.email?.stringValue || "").trim().toLowerCase();
  const name = employeeFields.name?.stringValue || memberFields.name?.stringValue || "IRPA Member/Employee";
  if (!number) return json({ok:false,error:"No IRPA member/employee registration number is currently assigned to this account."},409,corsHeaders(request));
  if (!email) return json({ok:false,error:"No official email address is available for this account."},409,corsHeaders(request));
  const subject = "IRPA Digital Board Governance — Registration Number Confirmation";