const FIREBASE_AUTH_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const FIREBASE_CUSTOM_TOKEN_AUDIENCE = "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";

function b64urlBytes(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlJson(value) {
  return b64urlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function fromBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function corsHeaders(request, env) {
  const origin = String(request.headers.get("Origin") || "");
  const allowed = String(env.IRPA_APP_URL || "https://irpa-digital-board-governance.web.app").replace(/\/$/, "");
  return {
    "Access-Control-Allow-Origin": origin === allowed ? origin : allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function firestoreValueToPlain(field) {
  if (!field) return null;
  if ("stringValue" in field) return field.stringValue;
  if ("booleanValue" in field) return field.booleanValue;
  if ("integerValue" in field) return Number(field.integerValue);
  if ("doubleValue" in field) return field.doubleValue;
  if ("timestampValue" in field) return field.timestampValue;
  if ("nullValue" in field) return null;
  if ("arrayValue" in field) return (field.arrayValue.values || []).map(firestoreValueToPlain);
  if ("mapValue" in field) {
    return Object.fromEntries(
      Object.entries(field.mapValue.fields || {}).map(([key, value]) => [key, firestoreValueToPlain(value)])
    );
  }
  return null;
}

function plainToFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === "number") return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(plainToFirestoreValue) } };
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plainToFirestoreValue(item)]))
      }
    };
  }
  throw new Error("Unsupported Firestore value.");
}

function parseInvitationToken(raw) {
  const parts = String(raw || "").trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    const error = new Error("The invitation token is invalid.");
    error.status = 400;
    throw error;
  }
  return { invitationId: parts[0], secret: parts[1] };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function importServiceAccountKey(serviceAccount) {
  const pem = String(serviceAccount.private_key || "").replace(/\\n/g, "\\n");
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\\s+/g, "");
  return crypto.subtle.importKey(
    "pkcs8",
    fromBase64(base64),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function fromBase64(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function createServiceAccountAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: FIREBASE_AUTH_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const key = await importServiceAccountKey(serviceAccount);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  const assertion = `${signingInput}.${b64urlBytes(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || "Firebase administrative OAuth token acquisition failed.");
  }
  return data.access_token;
}

async function getServiceAccount(env) {
  const raw = String(env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error("Cloudflare Firebase administrative credential is not configured.");
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new Error("Cloudflare Firebase administrative credential is invalid JSON.");
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key || !serviceAccount.project_id) {
    throw new Error("Cloudflare Firebase administrative credential is incomplete.");
  }
  if (serviceAccount.project_id !== String(env.FIREBASE_PROJECT_ID || "")) {
    throw new Error("Cloudflare Firebase administrative credential belongs to a different project.");
  }
  return serviceAccount;
}

async function googleApi(path, accessToken, options = {}) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || data.error?.status || "Firebase administrative API request failed.";
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function firestoreGetDocument(path, accessToken, projectId) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await response.json().catch(() => ({}));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(data.error?.message || "Unable to retrieve the invitation record.");
  }
  return data;
}

async function firestoreCommitRedemption(path, currentDocument, accessToken, projectId, uid) {
  const name = currentDocument.name;
  const fields = {
    invitationRedeemedUid: { stringValue: uid },
    invitationRedemptionStatus: { stringValue: "Redeemed — Awaiting Activation" },
    updatedAt: { timestampValue: new Date().toISOString() }
  };
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        writes: [{
          update: { name, fields },
          updateMask: {
            fieldPaths: ["invitationRedeemedUid", "invitationRedemptionStatus", "updatedAt"]
          },
          currentDocument: { updateTime: currentDocument.updateTime },
          updateTransforms: [{
            fieldPath: "invitationRedeemedAt",
            setToServerValue: "REQUEST_TIME"
          }]
        }
        }]
      })
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || "The invitation redemption could not be committed.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function lookupUserByEmail(email, accessToken, projectId) {
  const data = await googleApi(`/projects/${encodeURIComponent(projectId)}/accounts:lookup`, accessToken, {
    method: "POST",
    body: JSON.stringify({ email: [email] })
  });
  return data.users?.[0] || null;
}

async function createUser(email, displayName, accessToken, projectId) {
  const data = await googleApi(`/projects/${encodeURIComponent(projectId)}/accounts`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      email,
      displayName,
      emailVerified: false,
      disabled: false
    })
  });
  return data;
}

async function createFirebaseCustomToken(uid, serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: FIREBASE_CUSTOM_TOKEN_AUDIENCE,
    iat: now,
    exp: now + 3600,
    uid,
    claims: {
      irpaInvitationRedeemed: true
    }
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const key = await importServiceAccountKey(serviceAccount);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${b64urlBytes(signature)}`;
}

async function enforceRedeemRateLimit(request, env) {
  if (!env.DRIVE_KV) return;
  const ip = String(request.headers.get("CF-Connecting-IP") || "unknown").slice(0, 80);
  const key = `invitation-redeem-ip:${await sha256Hex(ip)}`;
  const current = Number(await env.DRIVE_KV.get(key) || 0);
  if (current >= 30) {
    const error = new Error("Invitation redemption rate limit exceeded. Please wait and try again.");
    error.status = 429;
    throw error;
  }
  await env.DRIVE_KV.put(key, String(current + 1), { expirationTtl: 600 });
}

export async function redeemInvitationToken(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405, corsHeaders(request, env));
  const origin = String(request.headers.get("Origin") || "");
  const allowedOrigin = String(env.IRPA_APP_URL || "https://irpa-digital-board-governance.web.app").replace(/\\/$/, "");
  if (origin && origin !== allowedOrigin) {
    return json({ ok: false, error: "Origin not authorized." }, 403, corsHeaders(request, env));
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400, corsHeaders(request, env));
  }

  try {
    await enforceRedeemRateLimit(request, env);
    const { invitationId, secret } = parseInvitationToken(body?.token);
    const serviceAccount = await getServiceAccount(env);
    const accessToken = await createServiceAccountAccessToken(serviceAccount);
    const projectId = String(env.FIREBASE_PROJECT_ID);

    const invitationDocument = await firestoreGetDocument(`invitations/${encodeURIComponent(invitationId)}`, accessToken, projectId);
    if (!invitationDocument) return json({ ok: false, error: "This IRPA invitation no longer exists." }, 404, corsHeaders(request, env));

    const invitation = Object.fromEntries(
      Object.entries(invitationDocument.fields || {}).map(([key, value]) => [key, firestoreValueToPlain(value)])
    );

    if (invitation.status === "Cancelled") return json({ ok: false, error: "This IRPA invitation has been cancelled." }, 409, corsHeaders(request, env));
    if (invitation.invitationRedeemedAt) return json({ ok: false, error: "This IRPA invitation token has already been redeemed. Ask an administrator to issue a fresh invitation." }, 409, corsHeaders(request, env));
    if (invitation.invitationTokenVersion !== "2" || !invitation.invitationTokenHash) {
      return json({ ok: false, error: "This invitation was issued under an older invitation mechanism. Ask an administrator to issue a fresh invitation." }, 412, corsHeaders(request, env));
    }

    const expiresAt = new Date(invitation.invitationExpiresAt || 0);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      return json({ ok: false, error: "This IRPA invitation has expired. Ask an administrator to issue a fresh invitation." }, 410, corsHeaders(request, env));
    }

    const suppliedHash = await sha256Hex(secret);
    const expectedHash = String(invitation.invitationTokenHash || "");
    if (expectedHash.length !== suppliedHash.length || !timingSafeEqualText(suppliedHash, expectedHash)) {
      return json({ ok: false, error: "The invitation token is invalid." }, 403, corsHeaders(request, env));
    }

    const email = String(invitation.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) return json({ ok: false, error: "The invitation has no valid recipient email." }, 412, corsHeaders(request, env));

    let user = await lookupUserByEmail(email, accessToken, projectId);
    if (!user) {
      try {
        user = await createUser(email, String(invitation.name || email.split("@")[0]), accessToken, projectId);
      } catch (error) {
        if (error.status !== 409 && !/already exists|email/i.test(error.message)) throw error;
        user = await lookupUserByEmail(email, accessToken, projectId);
      }
    }
    if (!user?.localId) throw new Error("Firebase Authentication did not return a user UID.");

    if (invitation.invitationRedeemedUid && invitation.invitationRedeemedUid !== user.localId) {
      return json({ ok: false, error: "This invitation has already been redeemed for another Firebase account." }, 409, corsHeaders(request, env));
    }

    const customToken = await createFirebaseCustomToken(user.localId, serviceAccount);
    await firestoreCommitRedemption(`invitations/${encodeURIComponent(invitationId)}`, invitationDocument, accessToken, projectId, user.localId);

    return json({
      ok: true,
      customToken,
      invitationId,
      uid: user.localId,
      email
    }, 200, corsHeaders(request, env));
  } catch (error) {
    const status = Number(error?.status || 500);
    console.error("IRPA invitation redemption failure", {
      status,
      code: error?.code || null,
      message: error?.message || String(error)
    });
    return json({
      ok: false,
      error: status >= 400 && status < 500 ? error.message : "IRPA_INVITATION_RUNTIME_FAILURE:REDEMPTION_BACKEND"
    }, status >= 400 && status < 500 ? status : 500, corsHeaders(request, env));
  }
}

function timingSafeEqualText(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i++) result |= left[i] ^ right[i];
  return result === 0;
}
