const FIREBASE_PROJECT_ID = "irpa-digital-board-governance";
const IDENTITY_TOOLKIT_SCOPE = "https://www.googleapis.com/auth/identitytoolkit";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const CUSTOM_TOKEN_AUDIENCE = "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";
const TOKEN_MAX_LIFETIME_SECONDS = 3600;

let cachedAdminCredentials = null;
let cachedGoogleAccessToken = null;
let cachedGoogleAccessTokenExpiresAt = 0;

export async function redeemInvitation(request, env) {
  const raw = String((await request.json().catch(() => ({})))?.token || "").trim();
  const parts = raw.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw invitationError(400, "The invitation token is invalid.");
  }

  const invitationId = parts[0];
  const secret = parts[1];
  const stageContext = { invitationId };

  const stageFailure = (stage, error) => {
    console.error("Invitation redemption stage failure", {
      stage,
      ...stageContext,
      code: error?.code || null,
      message: error?.message || String(error)
    });
    return invitationError(500, `IRPA_INVITATION_RUNTIME_FAILURE:${stage}`);
  };

  const logStage = (stage, status, extra = {}) => {
    console.log("Invitation redemption stage", {
      stage,
      status,
      ...stageContext,
      ...extra
    });
  };

  let adminToken;
  try {
    adminToken = await getGoogleAccessToken(env);
  } catch (error) {
    throw stageFailure("INVITATION_RETRIEVAL", error);
  }

  let invitation;
  try {
    invitation = await getInvitation(adminToken, invitationId);
    if (!invitation) throw invitationError(404, "This IRPA invitation no longer exists.");
    logStage("INVITATION_RETRIEVAL", "success");
  } catch (error) {
    if (isInvitationError(error)) throw error;
    throw stageFailure("INVITATION_RETRIEVAL", error);
  }

  try {
    validateInvitation(invitation, secret);
    logStage("INVITATION_VALIDATION", "success");
  } catch (error) {
    if (isInvitationError(error)) throw error;
    throw stageFailure("INVITATION_VALIDATION", error);
  }

  const email = String(invitation.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw invitationError(412, "The invitation has no valid recipient email.");
  }

  let user;
  try {
    user = await lookupUserByEmail(adminToken, email, env);
    logStage("AUTH_LOOKUP", "success", { found: Boolean(user) });
  } catch (error) {
    throw stageFailure("AUTH_LOOKUP", error);
  }

  if (!user) {
    try {
      user = await createUser(adminToken, email, String(invitation.name || email.split("@")[0]), env);
      logStage("AUTH_CREATE", "success");
    } catch (error) {
      if (error?.code === "EMAIL_EXISTS") {
        try {
          user = await lookupUserByEmail(adminToken, email, env);
          if (!user) throw new Error("Firebase Authentication reported an existing email but no user record was returned.");
          logStage("AUTH_LOOKUP", "success", { found: true, afterCreateRace: true });
        } catch (refetchError) {
          throw stageFailure("AUTH_LOOKUP", refetchError);
        }
      } else {
        throw stageFailure("AUTH_CREATE", error);
      }
    }
  }

  if (invitation.invitationRedeemedUid && invitation.invitationRedeemedUid !== user.localId) {
    throw invitationError(409, "This invitation has already been redeemed for another Firebase account.");
  }

  let customToken;
  try {
    customToken = await createFirebaseCustomToken(env, user.localId, invitationId);
    logStage("CUSTOM_TOKEN", "success");
  } catch (error) {
    throw stageFailure("CUSTOM_TOKEN", error);
  }

  try {
    await redeemInvitationTransaction(adminToken, invitationId, user.localId);
    logStage("REDEMPTION_TRANSACTION", "success");
  } catch (error) {
    if (isInvitationError(error)) throw error;
    throw stageFailure("REDEMPTION_TRANSACTION", error);
  }

  logStage("CALLABLE_RETURN", "success");
  return {
    ok: true,
    customToken,
    invitationId,
    uid: user.localId,
    email
  };
}

async async function validateInvitation(invitation, secret) {
  if (invitation.status === "Cancelled") {
    throw invitationError(412, "This IRPA invitation has been cancelled.");
  }
  if (invitation.invitationRedeemedAt) {
    throw invitationError(409, "This IRPA invitation token has already been redeemed. Ask an administrator to issue a fresh invitation.");
  }
  if (invitation.invitationTokenVersion !== "2" || !invitation.invitationTokenHash) {
    throw invitationError(412, "This invitation was issued under an older invitation mechanism. Ask an administrator to issue a fresh invitation.");
  }

  const expiryValue = invitation.invitationExpiresAt;
  const expiresAt = expiryValue?.timestampValue
    ? new Date(expiryValue.timestampValue)
    : expiryValue?.toDate
      ? expiryValue.toDate()
      : new Date(expiryValue || 0);

  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw invitationError(410, "This IRPA invitation has expired. Ask an administrator to issue a fresh invitation.");
  }

  const suppliedHash = await sha256Hex(secret);
  const expectedHash = String(invitation.invitationTokenHash || "");
  if (expectedHash.length !== suppliedHash.length || !timingSafeEqualHex(suppliedHash, expectedHash)) {
    throw invitationError(403, "The invitation token is invalid.");
  }
}

async function getInvitation(accessToken, invitationId) {
  const document = await googleFetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/invitations/${encodeURIComponent(invitationId)}`,
    accessToken
  );
  if (document.status === 404) return null;
  if (!document.ok) throw await googleApiError(document, "Unable to retrieve the IRPA invitation registry record.");
  return firestoreDocumentToPlain(await document.json());
}

async function lookupUserByEmail(accessToken, email, env) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts:lookup`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email: [email] })
    }
  );
  if (!response.ok) {
    const error = await googleApiError(response, "Firebase Authentication user lookup failed.");
    throw error;
  }
  const data = await response.json();
  const user = Array.isArray(data.users) ? data.users[0] : null;
  return user ? {
    localId: String(user.localId || ""),
    email: String(user.email || email).trim().toLowerCase(),
    disabled: user.disabled === true
  } : null;
}

async function createUser(accessToken, email, displayName, env) {
  const apiKey = String(env.FIREBASE_WEB_API_KEY || "").trim();
  if (!apiKey) throw new Error("FIREBASE_WEB_API_KEY is not configured for invitation redemption.");

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        displayName,
        emailVerified: false,
        disabled: false
      })
    }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = String(body?.error?.message || "");
    if (message === "EMAIL_EXISTS") {
      const error = new Error("EMAIL_EXISTS");
      error.code = "EMAIL_EXISTS";
      throw error;
    }
    throw new Error(message || "Firebase Authentication user creation failed.");
  }

  const data = await response.json();
  if (!data.localId) throw new Error("Firebase Authentication user creation returned no UID.");
  return {
    localId: String(data.localId),
    email
  };
}

async function createFirebaseCustomToken(env, uid, invitationId) {
  const credentials = await getAdminCredentials(env);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: credentials.client_email,
    sub: credentials.client_email,
    aud: CUSTOM_TOKEN_AUDIENCE,
    iat: now,
    exp: now + TOKEN_MAX_LIFETIME_SECONDS,
    uid,
    claims: {
      irpaInvitationId: invitationId,
      irpaInvitationRedeemed: true
    }
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const key = await importPrivateKey(credentials.private_key);
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  ));
  return `${signingInput}.${base64UrlEncodeBytes(signature)}`;
}

async function redeemInvitationTransaction(accessToken, invitationId, uid) {
  const database = `projects/${FIREBASE_PROJECT_ID}/databases/(default)`;
  const transactionResponse = await fetch(
    `https://firestore.googleapis.com/v1/${database}/documents:beginTransaction`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ options: { readWrite: {} } })
    }
  );
  if (!transactionResponse.ok) {
    throw await googleApiError(transactionResponse, "Unable to start the IRPA invitation redemption transaction.");
  }
  const transactionData = await transactionResponse.json();
  const transaction = transactionData.transaction;
  if (!transaction) throw new Error("Firestore did not return a transaction identifier.");

  const path = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/invitations/${encodeURIComponent(invitationId)}`;
  const readResponse = await fetch(
    `https://firestore.googleapis.com/v1/${path}?transaction=${encodeURIComponent(transaction)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (readResponse.status === 404) {
    throw invitationError(404, "This IRPA invitation no longer exists.");
  }
  if (!readResponse.ok) {
    throw await googleApiError(readResponse, "Unable to verify the IRPA invitation redemption state.");
  }

  const currentDocument = await readResponse.json();
  const current = firestoreDocumentToPlain(currentDocument);
  if (current.status === "Cancelled") throw invitationError(412, "This IRPA invitation has been cancelled.");
  if (current.invitationRedeemedAt) {
    throw invitationError(409, "This IRPA invitation token has already been redeemed. Ask an administrator to issue a fresh invitation.");
  }
  if (current.invitationRedeemedUid && current.invitationRedeemedUid !== uid) {
    throw invitationError(409, "This invitation has already been redeemed for another Firebase account.");
  }

  const updateFields = {
    invitationRedeemedUid: { stringValue: uid },
    invitationRedemptionStatus: { stringValue: "Redeemed — Awaiting Activation" }
  };

  const commitResponse = await fetch(
    `https://firestore.googleapis.com/v1/${database}/documents:commit`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        transaction,
        writes: [{
          update: {
            name: currentDocument.name,
            fields: updateFields
          },
          updateMask: {
            fieldPaths: [
              "invitationRedeemedUid",
              "invitationRedemptionStatus"
            ]
          },
          updateTransforms: [
            { fieldPath: "invitationRedeemedAt", setToServerValue: "REQUEST_TIME" },
            { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }
          ]
        }]
      })
    }
  );
  if (!commitResponse.ok) {
    throw await googleApiError(commitResponse, "Unable to complete the IRPA invitation redemption transaction.");
  }
}

async function getGoogleAccessToken(env) {
  if (cachedGoogleAccessToken && Date.now() < cachedGoogleAccessTokenExpiresAt - 60_000) {
    return cachedGoogleAccessToken;
  }

  const credentials = await getAdminCredentials(env);
  const now = Math.floor(Date.now() / 1000);
  const assertionHeader = { alg: "RS256", typ: "JWT" };
  const assertionPayload = {
    iss: credentials.client_email,
    scope: `${IDENTITY_TOOLKIT_SCOPE} ${FIRESTORE_SCOPE}`,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(assertionHeader))}.${base64UrlEncode(JSON.stringify(assertionPayload))}`;
  const key = await importPrivateKey(credentials.private_key);
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  ));
  const assertion = `${signingInput}.${base64UrlEncodeBytes(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!response.ok) throw await googleApiError(response, "Unable to obtain the controlled Google service authorization token.");

  const data = await response.json();
  if (!data.access_token) throw new Error("Google did not return a service authorization token.");
  cachedGoogleAccessToken = data.access_token;
  cachedGoogleAccessTokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  return cachedGoogleAccessToken;
}

async function getAdminCredentials(env) {
  if (cachedAdminCredentials) return cachedAdminCredentials;
  const raw = String(env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error("FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON is not configured.");
  const credentials = JSON.parse(raw);
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("The controlled Firebase service-account credential is incomplete.");
  }
  if (credentials.project_id && credentials.project_id !== FIREBASE_PROJECT_ID) {
    throw new Error("The controlled Firebase service-account credential belongs to a different project.");
  }
  cachedAdminCredentials = credentials;
  return credentials;
}

async function importPrivateKey(pem) {
  const normalized = String(pem).replace(/\\n/g, "\n");
  const base64 = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function googleFetch(url, accessToken, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {})
    }
  });
}

async function googleApiError(response, fallback) {
  const body = await response.json().catch(() => ({}));
  const message = String(body?.error?.message || body?.error?.status || fallback);
  const error = new Error(message);
  error.httpStatus = response.status;
  return error;
}

function invitationError(status, message) {
  const error = new Error(message);
  error.httpStatus = status;
  error.invitationError = true;
  return error;
}

function isInvitationError(error) {
  return error?.invitationError === true;
}

function firestoreDocumentToPlain(document) {
  const convert = field => {
    if (!field) return null;
    if ("stringValue" in field) return field.stringValue;
    if ("booleanValue" in field) return field.booleanValue;
    if ("integerValue" in field) return Number(field.integerValue);
    if ("doubleValue" in field) return field.doubleValue;
    if ("timestampValue" in field) return { timestampValue: field.timestampValue };
    if ("nullValue" in field) return null;
    if ("arrayValue" in field) return (field.arrayValue.values || []).map(convert);
    if ("mapValue" in field) return Object.fromEntries(Object.entries(field.mapValue.fields || {}).map(([k,v]) => [k, convert(v)]));
    return null;
  };
  return Object.fromEntries(Object.entries(document?.fields || {}).map(([k,v]) => [k, convert(v)]));
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

function base64UrlEncode(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
