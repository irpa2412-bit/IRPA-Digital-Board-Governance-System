const IDENTITY_TOOLKIT_SCOPE = "https://www.googleapis.com/auth/identitytoolkit";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CUSTOM_TOKEN_AUDIENCE = "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";

let accessTokenCache = null;

export class InvitationRedemptionError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "InvitationRedemptionError";
    this.status = status;
  }
}

export async function redeemInvitationToken(request, env) {
  const body = await readJson(request);
  const raw = String(body?.token || "").trim();
  const parts = raw.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new InvitationRedemptionError(400, "The invitation token is invalid.");
  }

  const projectId = String(env.FIREBASE_PROJECT_ID || "").trim();
  const serviceAccount = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (!projectId) throw new Error("Firebase project configuration is missing.");
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("Firebase service-account configuration is incomplete.");
  }

  const invitationId = parts[0];
  const secret = parts[1];
  const googleAccessToken = await getGoogleAccessToken(serviceAccount);
  const documentPath = `projects/${projectId}/databases/(default)/documents/invitations/${encodeURIComponent(invitationId)}`;
  const invitationDocument = await getFirestoreDocument(documentPath, googleAccessToken);

  if (!invitationDocument) {
    throw new InvitationRedemptionError(404, "This IRPA invitation no longer exists.");
  }

  const invitation = firestoreDocumentToPlain(invitationDocument.fields || {});
  await validateInvitation(invitation, invitationId, secret);

  const email = String(invitation.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new InvitationRedemptionError(400, "The invitation has no valid recipient email.");
  }

  const user = await getOrCreateFirebaseUser(projectId, email, invitation.name, googleAccessToken);
  if (user.disabled === true) {
    throw new InvitationRedemptionError(403, "This Firebase account is disabled. Ask an Administrator to reactivate the account.");
  }

  const customToken = await createFirebaseCustomToken(serviceAccount, user.localId, invitationId);
  await redeemFirestoreInvitation(documentPath, invitationDocument, user.localId, googleAccessToken);

  return {
    ok: true,
    customToken,
    invitationPassword: null,
    invitationId,
    uid: user.localId,
    email
  };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new InvitationRedemptionError(400, "The invitation redemption request is invalid.");
  }
}

function parseServiceAccount(raw) {
  if (!raw) throw new Error("Firebase service-account secret is not configured.");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Firebase service-account secret is not valid JSON.");
  }
}

async function getGoogleAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  if (accessTokenCache && accessTokenCache.expiresAt > now + 60) return accessTokenCache.token;

  const assertion = await signJwt({
    iss: serviceAccount.client_email,
    scope: `${IDENTITY_TOOLKIT_SCOPE} ${FIRESTORE_SCOPE}`,
    aud: OAUTH_TOKEN_URL,
    iat: now,
    exp: now + 3600
  }, serviceAccount.private_key);

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || "Unable to obtain Firebase service-account access.");
  }

  accessTokenCache = {
    token: data.access_token,
    expiresAt: now + Number(data.expires_in || 3600)
  };
  return data.access_token;
}

async function getOrCreateFirebaseUser(projectId, email, displayName, accessToken) {
  const lookupResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:lookup`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({email: [email]})
    }
  );

  const lookup = await lookupResponse.json().catch(() => ({}));
  if (!lookupResponse.ok) {
    throw new Error(lookup.error?.message || "Firebase account lookup failed.");
  }

  const existing = Array.isArray(lookup.users) ? lookup.users[0] : null;
  if (existing?.localId) return existing;

  const createResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        displayName: String(displayName || email.split("@")[0]).trim(),
        emailVerified: false,
        disabled: false
      })
    }
  );

  const created = await createResponse.json().catch(() => ({}));
  if (createResponse.ok && created.localId) return created;

  if (created.error?.message === "EMAIL_EXISTS") {
    const race = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:lookup`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({email: [email]})
      }
    );
    const raceData = await race.json().catch(() => ({}));
    if (race.ok && raceData.users?.[0]?.localId) return raceData.users[0];
  }

  throw new Error(created.error?.message || "Firebase account creation failed.");
}

function validateInvitation(invitation, invitationId, secret) {
  if (invitation.status === "Cancelled") {
    throw new InvitationRedemptionError(412, "This IRPA invitation has been cancelled.");
  }
  if (invitation.invitationRedeemedAt) {
    throw new InvitationRedemptionError(409, "This IRPA invitation token has already been redeemed. Ask an administrator to issue a fresh invitation.");
  }
  if (invitation.invitationTokenVersion !== "2" || !invitation.invitationTokenHash) {
    throw new InvitationRedemptionError(412, "This invitation was issued under an older invitation mechanism. Ask an administrator to issue a fresh invitation.");
  }

  const expiresAt = new Date(invitation.invitationExpiresAt || 0);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new InvitationRedemptionError(410, "This IRPA invitation has expired. Ask an administrator to issue a fresh invitation.");
  }

  const expectedHash = String(invitation.invitationTokenHash || "");
  return sha256Hex(secret).then(suppliedHash => {
    if (!constantTimeEqualHex(suppliedHash, expectedHash)) {
      throw new InvitationRedemptionError(403, "The invitation token is invalid.");
    }
    return invitationId;
  });
}

async function redeemFirestoreInvitation(documentPath, document, uid, accessToken) {
  const current = firestoreDocumentToPlain(document.fields || {});
  if (current.invitationRedeemedAt) {
    throw new InvitationRedemptionError(409, "This IRPA invitation token has already been redeemed. Ask an administrator to issue a fresh invitation.");
  }
  if (current.invitationRedeemedUid && current.invitationRedeemedUid !== uid) {
    throw new InvitationRedemptionError(409, "This invitation has already been redeemed for another Firebase account.");
  }

  const now = new Date().toISOString();
  const fields = {
    invitationRedeemedUid: {stringValue: uid},
    invitationRedeemedAt: {timestampValue: now},
    invitationRedemptionStatus: {stringValue: "Redeemed — Awaiting Activation"},
    updatedAt: {timestampValue: now}
  };

  const url = new URL(`https://firestore.googleapis.com/v1/${documentPath}`);
  for (const field of Object.keys(fields)) url.searchParams.append("updateMask.fieldPaths", field);
  url.searchParams.set("currentDocument.updateTime", document.updateTime);

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({fields})
  });

  if (response.status === 409 || response.status === 400) {
    throw new InvitationRedemptionError(409, "This invitation has already been redeemed or changed. Ask an administrator to issue a fresh invitation.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error?.message || "Unable to record the invitation redemption in Firestore.");
  }
}

async function getFirestoreDocument(path, accessToken) {
  const response = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
    headers: {Authorization: `Bearer ${accessToken}`}
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error?.message || "Unable to retrieve the IRPA invitation.");
  }
  return response.json();
}

function firestoreDocumentToPlain(fields) {
  const convert = field => {
    if (!field) return null;
    if (field.stringValue !== undefined) return field.stringValue;
    if (field.booleanValue !== undefined) return field.booleanValue;
    if (field.integerValue !== undefined) return Number(field.integerValue);
    if (field.doubleValue !== undefined) return Number(field.doubleValue);
    if (field.timestampValue !== undefined) return field.timestampValue;
    if (field.nullValue !== undefined) return null;
    if (field.arrayValue) return (field.arrayValue.values || []).map(convert);
    if (field.mapValue) return Object.fromEntries(Object.entries(field.mapValue.fields || {}).map(([k,v]) => [k, convert(v)]));
    return null;
  };
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, convert(value)]));
}

async function createFirebaseCustomToken(serviceAccount, uid, invitationId) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: CUSTOM_TOKEN_AUDIENCE,
    iat: now,
    exp: now + 3600,
    uid,
    claims: {
      irpaInvitationId: invitationId,
      irpaInvitationRedeemed: true
    }
  }, serviceAccount.private_key);
}

async function signJwt(payload, privateKeyPem) {
  const header = {alg: "RS256", typ: "JWT"};
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"},
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  ));
  return `${encodedHeader}.${encodedPayload}.${base64UrlEncode(signature)}`;
}

async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))));
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function pemToArrayBuffer(pem) {
  const base64 = String(pem || "")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\\s+/g, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
}

function base64UrlEncode(value) {
  let bytes;
  if (typeof value === "string") bytes = new TextEncoder().encode(value);
  else bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
