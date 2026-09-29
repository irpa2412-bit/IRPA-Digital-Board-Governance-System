const FIREBASE_PROJECT_ID = "irpa-digital-board-governance";
const AUTHORIZED_DRIVE_EMAIL = "irpa2412@gmail.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint","application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text","application/vnd.oasis.opendocument.spreadsheet","application/vnd.oasis.opendocument.presentation",
  "application/rtf","text/plain","text/csv","text/tab-separated-values","text/markdown","text/html","application/xhtml+xml",
  "application/epub+zip","application/json","application/xml","text/xml","image/png","image/jpeg","image/webp","image/svg+xml"
]);
const OAUTH_STATE_TTL = 600;
const SMTP_HOST = "mail.irpa.or.tz";
const SMTP_PORT = 465;
const SMTP_FROM = "info@irpa.or.tz";

let jwksCache = null;
let jwksFetchedAt = 0;
const MOCK_DRIVE_OBJECTS = new Map();
let MOCK_DRIVE_COUNTER = 0;
const MOCK_DRIVE_CONTROL = { secondChannelFailure: false, rollbackDeleteFailure: false, signatureProviderFailure: false };

export default {
  async fetch(request, env) {
    globalThis.__IRPA_LOCAL_TEST_MODE = env.LOCAL_TEST_MODE === "true";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      if (url.pathname === "/__test__/state" && request.method === "GET" && env.LOCAL_TEST_MODE === "true" && env.DRIVE_MOCK === "true") {
        const pending = await env.DRIVE_KV.list({prefix:"pending-drive-rollback:"});
        return json({ok:true,objects:Array.from(MOCK_DRIVE_OBJECTS.values()).filter(o=>o.mimeType!=="application/vnd.google-apps.folder").map(o=>({id:o.id,name:o.name,size:o.size})),pending:pending.keys.map(k=>k.name)},200,corsHeaders(request));
      }

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
  },
  async scheduled(controller, env) {
    await cleanupPendingDriveRollbacks(env);
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
      client_id: clientId,
      client_secret: clientSecret,
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
    return json({ ok: false, error: "This document format is not supported. Use PDF, Word, Excel, PowerPoint, OpenDocument, text/CSV, or supported image formats." }, 400, corsHeaders(request));
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_BYTES) {
    return json({ ok: false, error: "Uploaded files must not exceed 10 MB." }, 400, corsHeaders(request));
  }

  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (bytes.length !== fileSize) {
    return json({ ok: false, error: "Uploaded PDF size could not be verified." }, 400, corsHeaders(request));
  }

  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, stagingRootName(env));
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
  const testFailure = request.headers.get("X-IRPA-Test-Failure") || "";
  if (env.DRIVE_MOCK === "true") {
    MOCK_DRIVE_CONTROL.secondChannelFailure = testFailure === "second-channel" || testFailure === "second-channel-delete";
    MOCK_DRIVE_CONTROL.rollbackDeleteFailure = testFailure === "second-channel-delete";
  }
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
  const title = cleanName(data.title || fileName.replace(/\.pdf$/i, ""));
  const reference = cleanName(data.reference || "");
  const documentId = cleanId(data.documentId || `IRPA-DOC-${crypto.randomUUID()}`);
  const documentType = cleanName(data.documentType || "Governance Document");
  const archiveCategory = String(data.archiveCategory || "Administrative Documents").trim();
  const classification = String(data.classification || "Public").trim();
  const governanceArchive = data.governanceArchive !== false && /governance/i.test(documentType);

  const allowedCategories = ["Finance Documents","Procurement Documents","Governance Documents","Administrative Documents","Administrator Documents"];
  const allowedClassifications = ["Public","Internal","Confidential","Restricted"];
  if (!allowedCategories.includes(archiveCategory)) return json({ok:false,error:"Invalid document archive category."},400,corsHeaders(request));
  if (!allowedClassifications.includes(classification)) return json({ok:false,error:"Invalid document access classification."},400,corsHeaders(request));
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) return json({ok:false,error:"This document format is not supported for controlled-document routing."},400,corsHeaders(request));
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_BYTES) return json({ok:false,error:"Uploaded documents must not exceed 10 MB."},400,corsHeaders(request));

  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (bytes.length !== fileSize) return json({ok:false,error:"Uploaded document size could not be verified."},400,corsHeaders(request));
  if (contentType === "application/pdf") {
    const magic = new TextDecoder().decode(bytes.slice(0, 5));
    if (magic !== "%PDF-") return json({ok:false,error:"The uploaded file is not a valid PDF."},400,corsHeaders(request));
  }

  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, stagingRootName(env));

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
    if (env.DRIVE_MOCK === "true" && archiveChannel === "Board of Directors Governance Archive" && MOCK_DRIVE_CONTROL.secondChannelFailure) {
      MOCK_DRIVE_CONTROL.secondChannelFailure = false;
      throw new Error("Mocked second-channel upload failure.");
    }
    const result = await uploadDriveObject(env, metadata, bytes, contentType, body, boundary, archiveChannel);
    return {
      fileId:result.id,
      fileName:result.name,
      fileSize:Number(result.size||fileSize),
      webViewLink:result.webViewLink||`https://drive.google.com/file/d/${result.id}/view`,
      folderId,
      archiveChannel
    };
  };

  let categoryFile = null;
  let governanceFile = null;
  try {
    categoryFile = await uploadToFolder(categoryFolderId,"Controlled Documents",archiveCategory);
    governanceFile = governanceFolderId
      ? await uploadToFolder(governanceFolderId,"Board of Directors Governance Documents","Board of Directors Governance Archive")
      : null;
  } catch (error) {
    if (categoryFile?.fileId) {
      try { await deleteDriveFileById(env, categoryFile.fileId); } catch (cleanupError) { await recordPendingRollback(env,{documentId,fileId:categoryFile.fileId,createdAt:new Date().toISOString(),reason:cleanupError?.message || "rollback delete failed"}); console.error("Controlled-document rollback failed", cleanupError); }
    }
    if (governanceFile?.fileId) {
      try { await deleteDriveFileById(env, governanceFile.fileId); } catch (cleanupError) { await recordPendingRollback(env,{documentId,fileId:governanceFile.fileId,createdAt:new Date().toISOString(),reason:cleanupError?.message || "rollback delete failed"}); console.error("Governance archive rollback failed", cleanupError); }
    }
    throw error;
  }

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

  const buffer = await downloadDriveObject(env, fileId, accessToken);
  return json({
    ok: true,
    fileId,
    fileName: metadata.name,
    contentType: metadata.mimeType,
    base64: uint8ToBase64(buffer)
  }, 200, corsHeaders(request));
}



async function deleteDriveFileById(env, fileId) {
  if (env.DRIVE_MOCK === "true") {
    if (MOCK_DRIVE_CONTROL.rollbackDeleteFailure) {
      MOCK_DRIVE_CONTROL.rollbackDeleteFailure = false;
      throw new Error("Mocked rollback-delete failure.");
    }
    MOCK_DRIVE_OBJECTS.delete(fileId);
    return;
  }
  const accessToken = await getDriveAccessToken(env);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(`Drive rollback failed (${response.status}): ${body.slice(0, 300)}`);
  }
}

async function finalizeSignatureProfileArchives(request, env) {
  const claims = await authenticateFirebaseRequest(request);
  const data = await request.json();
  const envelopeId = cleanId(data.envelopeId || "");
  const finalHash = String(data.finalHash || "").trim();
  const originalHash = String(data.originalHash || "").trim();
  const base64 = String(data.base64 || "");
  const fileSize = Number(data.fileSize || 0);
  const injectedFailure = request.headers.get("X-IRPA-Test-Failure") || "";
  if (env.DRIVE_MOCK === "true") {
    MOCK_DRIVE_CONTROL.signatureProviderFailure = injectedFailure === "signature-provider";
  }
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

  const alreadyFinalizedHash = String(fields.signatureArchiveFinalHash?.stringValue || "").trim();
  const existingFileIds = firestoreStringArray(fields.signatureArchiveFileIds);
  if (alreadyFinalizedHash && alreadyFinalizedHash === finalHash) {
    return json({ok:true,envelopeId,deliveries:{},idempotent:true,fileIds:existingFileIds,originalHash:String(fields.signatureArchiveOriginalHash?.stringValue || originalHash)},200,corsHeaders(request));
  }

  const recipients = firestoreMapArray(fields.recipients);
  const actionRecipients = recipients.filter(r => !r.accessOnly && r.uid);
  if (!actionRecipients.length) {
    return json({ok:true,envelopeId,deliveries:{}},200,corsHeaders(request));
  }

  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (bytes.length !== fileSize) return json({ok:false,error:"Completed signed PDF size could not be verified."},400,corsHeaders(request));

  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, stagingRootName(env));
  const signaturesId = await findOrCreateFolder(env, accessToken, "Signature Profiles", rootId);
  const deliveries = {};
  const createdFileIds = [];

  try {
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
      if (env.DRIVE_MOCK === "true" && MOCK_DRIVE_CONTROL.signatureProviderFailure) {
        MOCK_DRIVE_CONTROL.signatureProviderFailure = false;
        throw new Error("Mocked signature-provider failure.");
      }
      const boundary = `irpa-${crypto.randomUUID()}`;
      const body = buildMultipartBody(boundary, metadata, bytes, "application/pdf");
      const result = await uploadDriveObject(env, metadata, bytes, "application/pdf", body, boundary, "Signature Profile");
      createdFileIds.push(result.id);
      deliveries[uid] = {
        fileId: result.id,
        fileName: result.name,
        webViewLink: result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`,
        folderId: completedFolderId,
        folderLink: `https://drive.google.com/drive/folders/${encodeURIComponent(completedFolderId)}`,
        myDocumentsPortal: "My Documents",
        myDocumentsPortalPath: `My Documents/Completed Signed Documents/${fileName}`,
        finalHash,
        originalHash,
        archiveProtocol: "IRPA-SIGNER-COPY-V2"
      };
    }
  } catch (error) {
    for (const fileId of createdFileIds) {
      try { await deleteDriveFileById(env, fileId); } catch (cleanupError) { console.error("Signature archive rollback failed", fileId, cleanupError?.message || cleanupError); }
    }
    throw error;
  }

  await updateFirestoreDocument(env, `signatureEnvelopes/${envelopeId}`, {
    signatureArchiveFinalHash: {stringValue: finalHash},
    signatureArchiveOriginalHash: {stringValue: originalHash},
    signatureArchiveFileIds: {arrayValue:{values:createdFileIds.map(stringValue)}},
    signatureArchiveCompleted: {booleanValue:true},
    signatureArchiveProtocol: {stringValue:"IRPA-SIGNER-COPY-V2"}
  }, claims.token);

  return json({ok:true,envelopeId,deliveries,idempotent:false,fileIds:createdFileIds,originalHash},200,corsHeaders(request));
}
function stringValue(value) { return {stringValue:String(value)}; }

function firestoreCollectionName(env, collectionName) {
  const logical = String(collectionName || "").replace(/^\/+|\/+$/g, "");
  if (!logical) throw new Error("Firestore collection name is required.");
  const prefix = String(env.FIRESTORE_COLLECTION_PREFIX || "").trim();
  if (String(env.ENVIRONMENT || "") === "staging" && !prefix) {
    throw new Error("Staging Firestore access requires a collection prefix.");
  }
  const resolved = prefix + logical;
  if (String(env.ENVIRONMENT || "") === "staging" && !resolved.startsWith(prefix)) {
    throw new Error("Staging Firestore collection escaped the required prefix.");
  }
  return resolved;
}

function firestoreDocumentPath(env, path) {
  const parts = String(path || "").split("/");
  if (!parts[0]) throw new Error("Firestore document path is required.");
  parts[0] = firestoreCollectionName(env, parts[0]);
  return parts.join("/");
}

async function updateFirestoreDocument(env, path, fields, firebaseToken) {
  const projectId = env.FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID;
  const resolvedPath = firestoreDocumentPath(env, path);
  const updateMask = Object.keys(fields).map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join("&");
  const response = await fetch(`${firestoreBaseUrl(env)}/v1/projects/${projectId}/databases/(default)/documents/${resolvedPath}?${updateMask}`, {
    method:"PATCH",
    headers:{"Authorization":`Bearer ${firestoreAuthToken(env, firebaseToken)}`,"Content-Type":"application/json"},
    body:JSON.stringify({fields})
  });
  if (!response.ok) throw new Error("Unable to update the Firestore record.");
  return response.json();
}


