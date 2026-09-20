const FIREBASE_PROJECT_ID = "irpa-digital-board-governance";
const AUTHORIZED_DRIVE_EMAIL = "irpa2412@gmail.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["application/pdf","image/png","image/jpeg","image/webp"]);
const OAUTH_STATE_TTL = 600;
const SMTP_HOST = "smtp.hostinger.com";
const SMTP_PORT = 465;
const SMTP_FROM = "info@irpa.or.tz";
const SMTP_CONNECT_TIMEOUT_MS = 6000;
const SMTP_RESPONSE_TIMEOUT_MS = 8000;
const SMTP_FALLBACK_HOST = "";

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

      if (url.pathname === "/api/upload" && request.method === "POST") {
        return await upload(request, env);
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
  const documentsId = await findOrCreateFolder(env, accessToken, "Controlled Documents", rootId);
  const purposeId = await findOrCreateFolder(env, accessToken, purpose, documentsId);

  const metadata = {
    name: fileName,
    parents: [purposeId],
    mimeType: contentType,
    description: JSON.stringify({
      irpaGovernance: true,
      uploadedByUid: claims.user_id,
      purpose
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


async function sendMemberInvitation(request, env) {
  const claims = await authenticateFirebaseRequest(request);
  const admin = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
  if (!admin?.fields?.active?.booleanValue) {
    return json({ ok:false, error:"Administrator authorization is required." },403,corsHeaders(request));
  }
  const data = await request.json();
  const invitationId = cleanId(data.invitationId || "");
  if (!invitationId) return json({ok:false,error:"Invitation ID is required."},400,corsHeaders(request));
  const invitation = await getFirestoreDocument(env, `invitations/${invitationId}`, claims.token);
  if (!invitation) return json({ok:false,error:"Invitation record was not found."},404,corsHeaders(request));
  const fields = invitation.fields || {};
  const email = String(fields.email?.stringValue || "").trim().toLowerCase();
  const name = String(fields.name?.stringValue || "").trim();
  const role = String(fields.role?.stringValue || "IRPA Member");
  if (!email) return json({ok:false,error:"Invitation email address is missing."},400,corsHeaders(request));
  const appUrl = String(env.IRPA_APP_URL || "https://irpa-digital-board-governance.web.app").replace(/\/$/,"");
  const link = `${appUrl}/?memberInvite=${encodeURIComponent(invitationId)}`;
  const subject = "IRPA Digital Board Governance — Invitation to Activate Your Account";
  const text = `Dear ${name || "IRPA Member"},\\n\\nYou have been invited to access the IRPA Digital Board Governance System as ${role}.\\n\\nActivate your account using this secure invitation link:\\n${link}\\n\\nOn the activation page, use your invited email address and create your permanent password. After activation, you can sign in normally using your email address and password.\\n\\nIf you did not expect this invitation, please contact Improvement of Rangeland in Pastoral Areas (IRPA).\\n\\nRegards,\\nIRPA Administration\\ninfo@irpa.or.tz`;
  const htmlBody = `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937"><h2>IRPA Digital Board Governance</h2><p>Dear ${escapeHtml(name || "IRPA Member")},</p><p>You have been invited to access the <strong>IRPA Digital Board Governance System</strong> as <strong>${escapeHtml(role)}</strong>.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 18px;background:#0f766e;color:#fff;text-decoration:none;border-radius:6px">Activate Your IRPA Account</a></p><p>On the activation page, use your invited email address and create your permanent password.</p><p>If you did not expect this invitation, please contact <a href="mailto:info@irpa.or.tz">info@irpa.or.tz</a>.</p><p>Regards,<br>IRPA Administration</p></body></html>`;
  const messageId = await smtpSendWithFallback(env, {to:email, subject, text, html:htmlBody});
  return json({ok:true,email,emailRequested:true,provider:"IRPA Mail Server",deliveryStatus:"Submitted to mail.irpa.or.tz",messageId},200,corsHeaders(request));
}

async function smtpSendWithFallback(env, message) {
  const configuredHost = String(env.SMTP_HOST || SMTP_HOST).trim();
  const hosts = [configuredHost].filter(Boolean);

  const configuredPort = Number(env.SMTP_PORT || SMTP_PORT);
  const ports = configuredPort === 465 ? [465, 587] : [configuredPort, configuredPort === 587 ? 465 : 587];

  let lastError = null;
  for (const host of hosts) {
    for (const port of [...new Set(ports)]) {
      try {
        console.log("SMTP attempt", { host, port });
        return await smtpSend(env, message, host, port);
      } catch (error) {
        lastError = error;
        console.error("SMTP attempt failed", { host, port, error: error?.message || String(error) });
      }
    }
  }

  throw new Error(
    lastError?.message ||
    "IRPA mail server could not be reached. The invitation was not sent."
  );
}

async function smtpSend(env,{to,subject,text,html}, host, port) {
  if (!env.SMTP_PASSWORD) throw new Error("IRPA SMTP password is not configured in the deployment environment.");
  const { connect } = await import("cloudflare:sockets");
  const useStartTls = Number(port) === 587;
  let socket = connect(
    {hostname:host,port:Number(port)},
    {secureTransport:useStartTls ? "starttls" : "on"}
  );

  let reader = null;
  let writer = null;
  let buffer = "";

  async function readResponse() {
    while (true) {
      const {value,done}=await Promise.race([
        reader.read(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`IRPA SMTP server ${host}:${port} did not respond within ${SMTP_RESPONSE_TIMEOUT_MS / 1000} seconds.`)), SMTP_RESPONSE_TIMEOUT_MS)
        )
      ]);
      if (done) throw new Error("SMTP server closed the connection.");
      buffer += new TextDecoder().decode(value);
      const lines=buffer.split("\r\n");
      buffer=lines.pop() || "";
      for (const line of lines) {
        if (/^\d{3} /.test(line)) {
          const code=Number(line.slice(0,3));
          if (code>=400) throw new Error(`IRPA SMTP error ${code}: ${line.slice(4)}`);
          return line;
        }
      }
    }
  }

  async function command(value, expectedClass) {
    await writer.write(new TextEncoder().encode(value+"\r\n"));
    const line=await readResponse();
    if (expectedClass && !line.startsWith(String(expectedClass))) throw new Error("Unexpected SMTP response: "+line);
    return line;
  }

  try {
    await Promise.race([
      socket.opened,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`IRPA SMTP connection to ${host}:${port} timed out after ${SMTP_CONNECT_TIMEOUT_MS / 1000} seconds.`)), SMTP_CONNECT_TIMEOUT_MS)
      )
    ]);
    reader = socket.readable.getReader();
    writer = socket.writable.getWriter();

    await readResponse();
    await command("EHLO irpa-digital-board-governance","2");

    if (useStartTls) {
      await command("STARTTLS","2");
      const secureSocket = socket.startTls();
      try { reader.releaseLock(); } catch {}
      try { writer.releaseLock(); } catch {}
      socket = secureSocket;
      reader = socket.readable.getReader();
      writer = socket.writable.getWriter();
      buffer = "";
      await command("EHLO irpa-digital-board-governance","2");
    }

    await command("AUTH PLAIN "+btoa("\0"+SMTP_FROM+"\0"+env.SMTP_PASSWORD),"2");
    await command(`MAIL FROM:<${SMTP_FROM}>`,"2");
    await command(`RCPT TO:<${to}>`,"2");
    await command("DATA","3");

    const boundary="IRPA-"+crypto.randomUUID();
    const mime=[
      `From: "IRPA Administration" <${SMTP_FROM}>`,
      `To: <${to}>`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      text,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      html,
      "",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    await writer.write(new TextEncoder().encode(mime+"\r\n.\r\n"));
    const accepted=await readResponse();
    if (!accepted.startsWith("2")) throw new Error("SMTP message was not accepted: "+accepted);
    await command("QUIT","2");
    return accepted;
  } finally {
    try { reader.releaseLock(); } catch {}
    try { writer.releaseLock(); } catch {}
    try { await socket.close(); } catch {}
  }
}

async function deleteDriveFile(request, env) {
  const claims = await authenticateFirebaseRequest(request);
  const data = await request.json();

  const fileId = String(data.fileId || "").trim();
  const documentId = String(data.documentId || "").trim();

  if (!fileId) {
    return json(
      { ok: false, error: "Google Drive file ID is required." },
      400,
      corsHeaders(request)
    );
  }

  if (!documentId) {
    return json(
      { ok: false, error: "Firestore document ID is required." },
      400,
      corsHeaders(request)
    );
  }

  const admin = await getFirestoreDocument(
    env,
    `adminProfiles/${claims.user_id}`,
    claims.token
  );

  if (!admin?.fields?.active?.booleanValue) {
    return json(
      { ok: false, error: "Administrator authorization is required." },
      403,
      corsHeaders(request)
    );
  }

  const document = await getFirestoreDocument(
    env,
    `documents/${documentId}`,
    claims.token
  );

  if (!document) {
    return json(
      { ok: false, error: "The controlled document record was not found." },
      404,
      corsHeaders(request)
    );
  }

  const storedFileId = document?.fields?.fileId?.stringValue || "";

  if (!storedFileId || storedFileId !== fileId) {
    return json(
      { ok: false, error: "The supplied Drive file does not match the controlled document record." },
      409,
      corsHeaders(request)
    );
  }

  const accessToken = await getDriveAccessToken(env);

  const metadata = await driveFetch(
    env,
    accessToken,
    `/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,description,trashed`
  );

  const description = parseDescription(metadata.description);

  if (!description?.irpaGovernance) {
    return json(
      { ok: false, error: "The requested file is not an IRPA governance document." },
      403,
      corsHeaders(request)
    );
  }

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Google Drive deletion failed (${response.status}): ${errorText.slice(0, 500)}`
    );
  }

  return json(
    {
      ok: true,
      fileId,
      fileName: metadata.name || "Document",
      documentId,
      deletedByUid: claims.user_id
    },
    200,
    corsHeaders(request)
  );
}



async function getDriveAccessToken(env) {
  const stored = await env.DRIVE_KV.get("google-drive-refresh-token", "json");
  if (!stored?.encrypted) throw new Error("Google Drive has not yet been authorized.");

  const refreshToken = await decryptText(stored.encrypted, env.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const tokens = await response.json();
  if (!response.ok || !tokens.access_token) throw new Error(tokens.error_description || "Google Drive access token refresh failed.");
  return tokens.access_token;
}

async function findOrCreateFolder(env, accessToken, name, parentId = null) {
  const safeName = name.replace(/'/g, "\\'");
  const q = [
    `name='${safeName}'`,
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    parentId ? `'${parentId}' in parents` : null
  ].filter(Boolean).join(" and ");
  const listed = await driveFetch(env, accessToken, `/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&pageSize=10&fields=files(id,name,parents)`);
  if (listed.files?.[0]?.id) return listed.files[0].id;

  const created = await driveFetch(env, accessToken, "/drive/v3/files", {
    method: "POST",
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
      description: JSON.stringify({ irpaGovernanceFolder: true })
    })
  });
  return created.id;
}

async function driveFetch(env, accessToken, path, options = {}) {
  const response = await fetch(`https://www.googleapis.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(data.error?.message || "Google Drive API request failed.");
  return data;
}

async function authenticateFirebaseRequest(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Firebase authentication is required.");

  const token = match[1];
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid Firebase ID token.");

  const headerPart = JSON.parse(base64UrlDecode(parts[0]));
  const payload = JSON.parse(base64UrlDecode(parts[1]));
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) throw new Error("Invalid Firebase token issuer.");
  if (payload.aud !== FIREBASE_PROJECT_ID) throw new Error("Invalid Firebase token audience.");
  if (!payload.sub || Number(payload.exp || 0) <= now) throw new Error("Firebase token is expired.");

  const jwks = await getFirebaseJwks();
  const jwk = jwks[headerPart.kid];
  if (!jwk) throw new Error("Firebase token signing key not found.");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) throw new Error("Invalid Firebase ID token signature.");

  return { token, user_id: payload.user_id || payload.sub, email: payload.email || null };
}

async function getFirebaseJwks() {
  if (jwksCache && Date.now() - jwksFetchedAt < 60 * 60 * 1000) {
    return jwksCache;
  }

  const response = await fetch(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  );

  if (!response.ok) {
    throw new Error("Unable to retrieve Firebase signing keys.");
  }

  const data = await response.json();

  if (!Array.isArray(data.keys) || data.keys.length === 0) {
    throw new Error("Firebase signing keys were not returned.");
  }

  jwksCache = Object.fromEntries(
    data.keys.map((key) => [key.kid, key])
  );

  jwksFetchedAt = Date.now();

  return jwksCache;
}

async function getFirestoreDocument(env, path, firebaseToken) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${firebaseToken}` }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Unable to verify the Firestore authorization record.");
  return response.json();
}

function firestoreStringArray(field) {
  return field?.arrayValue?.values?.map(v => v.stringValue).filter(Boolean) || [];
}

async function encryptText(plaintext, secret) {
  const key = await crypto.subtle.importKey("raw", base64Bytes(secret), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)));
  return JSON.stringify({
    iv: uint8ToBase64(iv),
    ciphertext: uint8ToBase64(ciphertext)
  });
}

async function decryptText(record, secret) {
  const parsed = typeof record === "string" ? JSON.parse(record) : record;
  const key = await crypto.subtle.importKey("raw", base64Bytes(secret), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64Bytes(parsed.iv) }, key, base64Bytes(parsed.ciphertext));
  return new TextDecoder().decode(plaintext);
}

function buildMultipartBody(boundary, metadata, bytes, contentType) {
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return body;
}

function cleanName(value) {
  return String(value).trim().replace(/[\\/:*?"<>|]/g, "-").slice(0, 160) || "Document";
}

function cleanId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "");
}

function randomBase64Url(size) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return uint8ToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function base64UrlDecode(value) {
  return new TextDecoder().decode(base64UrlBytes(value));
}

function base64UrlBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(normalized), c => c.charCodeAt(0));
}

function base64Bytes(value) {
  return Uint8Array.from(atob(String(value)), c => c.charCodeAt(0));
}

function uint8ToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function parseDescription(value) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function html(message, status = 200) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>IRPA Google Drive</title></head><body><h2>${escapeHtml(message)}</h2></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = origin === "https://irpa.or.tz" || origin === "https://www.irpa.or.tz" || origin === "https://irpa-digital-board-governance.web.app" || origin === "https://irpa-digital-board-governance.firebaseapp.com" || origin === "http://localhost:5173" || origin === "http://localhost:4173";
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://irpa.or.tz",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Cache-Control, X-IRPA-Invitation-Version",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin"
  };
}
