
const PROJECT = "irpa-digital-board-governance";
const TOKEN_TTL_MS = 60 * 60 * 1000;
const RATE_WINDOW_SECONDS = 600;
const INVITATION_RATE_LIMIT = 10;
const IP_RATE_LIMIT = 30;
let googleAccessToken = null;
let googleAccessTokenExpiresAt = 0;

export const INVITATION_STATES = Object.freeze({
  PASSWORD_SETUP_PENDING: "PASSWORD_SETUP_PENDING",
  PROVISIONING_PENDING: "PROVISIONING_PENDING",
  ACTIVATED: "ACTIVATED",
  NONE: "NONE",
});

export function invitationFailure(stage, status, message) {
  return {
    ok: false,
    status,
    error: "IRPA_INVITATION_FAILURE:" + stage,
    message,
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function b64urlBytes(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (String(value).length % 4)) % 4);
  return Uint8Array.from(atob(normalized), c => c.charCodeAt(0));
}

function b64url(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function parseServiceAccount(env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON || env.FIREBASE_SERVICE_ACCOUNT || "";
  if (!raw) throw new Error("Firebase server credentials are not configured.");
  const account = JSON.parse(raw);
  if (!account.client_email || !account.private_key) throw new Error("Firebase server credentials are incomplete.");
  return account;
}

async function signJwt(payload, account) {
  const header = { alg: "RS256", typ: "JWT" };
  const input = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(payload));
  const pem = account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\s/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    b64urlBytes(b64url(new Uint8Array(atob(pem).split("").map(c => c.charCodeAt(0))))),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(input),
  );
  return input + "." + b64url(new Uint8Array(signature));
}

async function getGoogleAccessToken(env) {
  if (googleAccessToken && Date.now() < googleAccessTokenExpiresAt - 60_000) return googleAccessToken;
  const account = parseServiceAccount(env);
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }, account);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error("Unable to obtain Firebase server authorization.");
  const body = await response.json();
  googleAccessToken = body.access_token;
  googleAccessTokenExpiresAt = Date.now() + Number(body.expires_in || 3600) * 1000;
  return googleAccessToken;
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === "number") return { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === "object") {
    const fields = {};
    for (const [key, item] of Object.entries(value)) fields[key] = firestoreValue(item);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function fromFirestoreValue(value) {
  if (!value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in value) return fromFirestoreFields(value.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields) {
  const result = {};
  for (const [key, value] of Object.entries(fields || {})) result[key] = fromFirestoreValue(value);
  return result;
}

async function firestoreRequest(env, path, options = {}) {
  const token = await getGoogleAccessToken(env);
  const response = await fetch("https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents" + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (response.status === 404) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Invitation Firestore operation failed", { stage: options.stage || "FIRESTORE", status: response.status });
    throw new Error("Firestore server operation failed.");
  }
  return body;
}

async function getDocument(env, collection, id) {
  return firestoreRequest(env, "/" + collection + "/" + encodeURIComponent(id));
}

async function queryDocuments(env, collection, fieldPath, value) {
  const token = await getGoogleAccessToken(env);
  const response = await fetch("https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents:runQuery", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath }, op: "EQUAL", value: firestoreValue(value) } },
        limit: 20,
      },
    }),
  });
  if (!response.ok) throw new Error("Firestore server query failed.");
  const rows = await response.json();
  return (Array.isArray(rows) ? rows : [])
    .map(row => row.document)
    .filter(Boolean)
    .map(document => ({
      ...fromFirestoreFields(document.fields || {}),
      __name: document.name,
      __updateTime: document.updateTime || null,
    }));
}

async function commitActivation(env, { invitationId, invitationUpdateTime, uid, email, invitation, existingMember }) {
  const now = new Date().toISOString();
  const memberPath = "projects/" + PROJECT + "/databases/(default)/documents/members/" + uid;
  const invitationPath = "projects/" + PROJECT + "/databases/(default)/documents/invitations/" + invitationId;

  const privileged = ["role", "admin", "isAdmin", "administrator", "adminFlags", "permissions", "roleAssignments"];
  if (existingMember) {
    const conflicts = privileged.filter(field => existingMember[field] !== undefined && existingMember[field] !== null);
    if (existingMember.role && invitation.role && existingMember.role !== invitation.role) conflicts.push("role-conflict");
    if (conflicts.length) {
      return { ok: false, conflict: true, fields: [...new Set(conflicts)] };
    }
  }

  const memberFields = {
    uid: firestoreValue(uid),
    email: firestoreValue(email),
    memberType: firestoreValue(invitation.memberType || "Governance Member"),
    accountActivated: firestoreValue(true),
    registrationStatus: firestoreValue("Activated"),
    status: firestoreValue(existingMember?.status || "Active"),
    activatedAt: firestoreValue(now),
    updatedAt: firestoreValue(now),
    invitationId: firestoreValue(invitationId),
  };
  if (!existingMember) {
    memberFields.name = firestoreValue(invitation.name || "");
    memberFields.role = firestoreValue(invitation.role || "Board Member");
    memberFields.createdAt = firestoreValue(now);
  }

  const invitationFields = {
    status: firestoreValue("ACTIVATED"),
    acceptedUid: firestoreValue(uid),
    acceptedAt: firestoreValue(now),
    accountActivated: firestoreValue(true),
    activationCompleted: firestoreValue(true),
    invitationRedeemedUid: firestoreValue(uid),
    invitationRedeemedAt: firestoreValue(invitation.invitationRedeemedAt || now),
    updatedAt: firestoreValue(now),
  };

  const memberWrite = {
    update: { name: memberPath, fields: memberFields },
    currentDocument: existingMember ? { exists: true } : { exists: false },
  };
  if (existingMember) {
    memberWrite.updateMask = {
      fieldPaths: ["uid", "email", "memberType", "accountActivated", "registrationStatus", "status", "activatedAt", "updatedAt", "invitationId"],
    };
  }

  const invitationWrite = {
    update: { name: invitationPath, fields: invitationFields },
    updateMask: { fieldPaths: Object.keys(invitationFields) },
    currentDocument: invitationUpdateTime ? { updateTime: invitationUpdateTime } : undefined,
  };

  const token = await getGoogleAccessToken(env);
  const response = await fetch("https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents:commit", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ writes: [memberWrite, invitationWrite] }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    console.error("Invitation activation atomic commit failed", { status: response.status, reason: body?.error?.status || "UNKNOWN" });
    throw new Error("Atomic invitation activation commit failed.");
  }
  return { ok: true, state: INVITATION_STATES.ACTIVATED };
}

async function authApi(env, operation, body) {
  const key = env.FIREBASE_WEB_API_KEY;
  if (!key) throw new Error("Firebase Web API key is not configured.");
  const response = await fetch("https://identitytoolkit.googleapis.com/v1/" + operation + "?key=" + encodeURIComponent(key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function existingAccountProviders(env, email) {
  const { response, data } = await authApi(env, "accounts:createAuthUri", {
    identifier: email,
    continueUri: "https://irpa.or.tz/",
  });
  if (!response.ok) throw new Error("Firebase account lookup failed.");
  return { registered: data.registered === true, providers: Array.isArray(data.allProviders) ? data.allProviders : [] };
}

async function mintCustomToken(env, uid) {
  const account = parseServiceAccount(env);
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    iss: account.client_email,
    sub: account.client_email,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid,
  }, account);
}

async function rateLimit(env, key, limit) {
  if (!env.DRIVE_KV) return { allowed: true };
  const bucket = Math.floor(Date.now() / (RATE_WINDOW_SECONDS * 1000));
  const storageKey = "invitation-rate:" + key + ":" + bucket;
  const current = Number(await env.DRIVE_KV.get(storageKey) || 0);
  if (current >= limit) return { allowed: false, retryAfter: RATE_WINDOW_SECONDS };
  await env.DRIVE_KV.put(storageKey, String(current + 1), { expirationTtl: RATE_WINDOW_SECONDS + 5 });
  return { allowed: true };
}

function invitationExpiry(invitation) {
  const explicit = invitation.invitationExpiresAt ? Date.parse(invitation.invitationExpiresAt) : NaN;
  if (Number.isFinite(explicit)) return explicit;
  const created = invitation.createdAt ? Date.parse(invitation.createdAt) : NaN;
  return Number.isFinite(created) ? created + TOKEN_TTL_MS : 0;
}

function normalizeInvitationState(invitation, uid = null) {
  if (!invitation) return INVITATION_STATES.NONE;
  const status = String(invitation.status || "").toUpperCase();
  if (status === "ACTIVATED" || status === "ACTIVE" || status === "ACCEPTED" && invitation.accountActivated === true) return INVITATION_STATES.ACTIVATED;
  if (status === "PROVISIONING_PENDING" && (!uid || invitation.invitationRedeemedUid === uid)) return INVITATION_STATES.PROVISIONING_PENDING;
  if (invitation.invitationRedeemedUid && (!uid || invitation.invitationRedeemedUid === uid)) return INVITATION_STATES.PASSWORD_SETUP_PENDING;
  return INVITATION_STATES.NONE;
}

export async function redeemInvitationToken(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipLimit = await rateLimit(env, "ip:" + (await sha256Hex(ip)), IP_RATE_LIMIT);
  if (!ipLimit.allowed) return json(invitationFailure("REDEEM_RATE_LIMIT_IP", 429, "Too many invitation attempts. Try again later."), 429);

  const body = await request.json().catch(() => ({}));
  const rawToken = String(body.token || "").trim();
  const dot = rawToken.indexOf(".");
  if (dot < 1) return json(invitationFailure("REDEEM_TOKEN", 400, "The invitation link is invalid."), 400);
  const invitationId = rawToken.slice(0, dot);
  const secret = rawToken.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(invitationId) || secret.length < 20) {
    return json(invitationFailure("REDEEM_TOKEN", 400, "The invitation link is invalid."), 400);
  }

  try {
    const doc = await getDocument(env, "invitations", invitationId);
    if (!doc) return json(invitationFailure("REDEEM_LOOKUP", 404, "This invitation is no longer available."), 404);
    const invitation = fromFirestoreFields(doc.fields || {});
    const status = String(invitation.status || "").toUpperCase();
    if (status === "CANCELLED") return json(invitationFailure("REDEEM_CANCELLED", 410, "This invitation has been cancelled."), 410);
    if (status === "ACTIVATED") return json(invitationFailure("REDEEM_USED", 410, "This invitation link has already been used."), 410);
    const expiresAt = invitationExpiry(invitation);
    if (!expiresAt || Date.now() >= expiresAt) return json(invitationFailure("REDEEM_EXPIRED", 410, "This invitation has expired."), 410);

    const expected = String(invitation.invitationTokenHash || "");
    const actual = await sha256Hex(secret);
    if (!expected || expected !== actual) return json(invitationFailure("REDEEM_TOKEN", 403, "The invitation link is invalid."), 403);

    const invitationLimit = await rateLimit(env, "invitation:" + invitationId, INVITATION_RATE_LIMIT);
    if (!invitationLimit.allowed) return json(invitationFailure("REDEEM_RATE_LIMIT_INVITATION", 429, "This invitation has reached its temporary attempt limit. Try again later."), 429);

    if (status === "PROVISIONING_PENDING" && invitation.invitationRedeemedUid) {
      console.info("Invitation redemption is idempotent", { stage: "REDEEM_IDEMPOTENT", invitationId });
      return json({
        ok: true,
        invitationId,
        uid: invitation.invitationRedeemedUid,
        state: INVITATION_STATES.PROVISIONING_PENDING,
        customToken: await mintCustomToken(env, invitation.invitationRedeemedUid),
      }, 200);
    }

    const providers = await existingAccountProviders(env, String(invitation.email || "").trim().toLowerCase());
    if (providers.registered) {
      return json(invitationFailure("REDEEM_EXISTING_ACCOUNT", 409, "An existing Firebase account is already registered for this invitation email. Use the normal login or ask an administrator to issue a new invitation."), 409);
    }

    const uid = invitation.invitationRedeemedUid || crypto.randomUUID().replace(/-/g, "");
    const nextState = invitation.invitationRedeemedUid ? "PROVISIONING_PENDING" : "PROVISIONING_PENDING";
    const now = new Date().toISOString();
    const token = await getGoogleAccessToken(env);
    const response = await fetch("https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents:commit", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        writes: [{
          update: {
            name: doc.name,
            fields: {
              status: firestoreValue(nextState),
              invitationRedeemedUid: firestoreValue(uid),
              invitationRedeemedAt: firestoreValue(invitation.invitationRedeemedAt || now),
              updatedAt: firestoreValue(now),
            },
          },
          updateMask: { fieldPaths: ["status", "invitationRedeemedUid", "invitationRedeemedAt", "updatedAt"] },
          currentDocument: { updateTime: doc.updateTime },
        }],
      }),
    });
    if (!response.ok) return json(invitationFailure("REDEEM_STATE", 409, "The invitation state changed. Reopen the invitation and try again."), 409);

    console.info("Invitation redemption accepted", { stage: "REDEEM_COMPLETE", invitationId, state: nextState });
    return json({ ok: true, invitationId, uid, state: nextState, customToken: await mintCustomToken(env, uid) }, 200);
  } catch (error) {
    console.error("Invitation redemption failed", { stage: "REDEEM_SERVER", message: String(error?.message || error) });
    return json(invitationFailure("REDEEM_SERVER", 500, "The invitation could not be processed. Please try again."), 500);
  }
}

export async function invitationSessionState(request, env, authenticate) {
  let claims;
  try { claims = await authenticate(request); }
  catch (error) {
    return json(invitationFailure("SESSION_AUTH", 401, "Authentication is required."), 401);
  }
  try {
    const rows = await queryDocuments(env, "invitations", "invitationRedeemedUid", claims.user_id);
    const own = rows
      .filter(row => String(row.invitationRedeemedUid || "") === claims.user_id)
      .sort((a,b) => Date.parse(String(b.updatedAt || "")) - Date.parse(String(a.updatedAt || "")))[0];
    if (!own) return json({ ok: true, state: INVITATION_STATES.NONE, invitationId: null }, 200);
    const invitationId = own.__name.split("/").pop();
    const rawState = normalizeInvitationState(own, claims.user_id);
    if (rawState === INVITATION_STATES.PROVISIONING_PENDING) {
      const redemptionState = normalizeInvitationState(invitation, claims.user_id);
    if (redemptionState === INVITATION_STATES.PROVISIONING_PENDING) {
      return json({ ok: true, invitationId, uid: claims.user_id, state: INVITATION_STATES.PROVISIONING_PENDING }, 200);
    }

    const account = await authApi(env, "accounts:lookup", { idToken: claims.token });
      if (account.response.ok) {
        const providers = (account.data?.users?.[0]?.providerUserInfo || []).map(x => x.providerId);
        return json({
          ok: true,
          state: providers.includes("password") ? INVITATION_STATES.PROVISIONING_PENDING : INVITATION_STATES.PASSWORD_SETUP_PENDING,
          invitationId,
        }, 200);
      }
    }
    return json({ ok: true, state: rawState, invitationId }, 200);
  } catch (error) {
    console.error("Invitation session-state failed", { stage: "SESSION_STATE" });
    return json(invitationFailure("SESSION_STATE", 500, "Invitation session state is temporarily unavailable."), 500);
  }
}

export async function passwordSet(request, env, authenticate) {
  let claims;
  try { claims = await authenticate(request); }
  catch {
    return json(invitationFailure("PASSWORD_AUTH", 401, "Authentication is required."), 401);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const invitationId = String(body.invitationId || "").trim();
    if (!invitationId) return json(invitationFailure("PASSWORD_INPUT", 400, "Invitation ID is required."), 400);

    const invitationDoc = await getDocument(env, "invitations", invitationId);
    if (!invitationDoc) return json(invitationFailure("PASSWORD_LOOKUP", 404, "The invitation could not be found."), 404);
    const invitation = fromFirestoreFields(invitationDoc.fields || {});
    if (String(invitation.invitationRedeemedUid || "") !== claims.user_id) return json(invitationFailure("PASSWORD_UID", 403, "This invitation is not assigned to the authenticated account."), 403);
    if (String(invitation.status || "").toUpperCase() === "CANCELLED") return json(invitationFailure("PASSWORD_CANCELLED", 410, "This invitation has been cancelled."), 410);
    if (invitationExpiry(invitation) && Date.now() >= invitationExpiry(invitation) && String(invitation.status || "").toUpperCase() !== "ACTIVATED") {
      return json(invitationFailure("PASSWORD_EXPIRED", 410, "This invitation has expired."), 410);
    }
    if (String(invitation.status || "").toUpperCase() === "ACTIVATED") {
      return json({ ok: true, state: INVITATION_STATES.ACTIVATED, invitationId }, 200);
    }

    const account = await authApi(env, "accounts:lookup", { idToken: claims.token });
    if (!account.response.ok) throw new Error("Firebase account lookup failed.");
    const providers = (account.data?.users?.[0]?.providerUserInfo || []).map(x => x.providerId);
    if (!providers.includes("password")) {
      return json(invitationFailure("PASSWORD_PROVIDER", 409, "The permanent password has not been configured yet. Return to the invitation password screen and save it again."), 409);
    }

    const existingMemberDoc = await getDocument(env, "members", claims.user_id);
    const existingMember = existingMemberDoc ? fromFirestoreFields(existingMemberDoc.fields || {}) : null;
    const activation = await commitActivation(env, {
      invitationId,
      invitationUpdateTime: invitationDoc.updateTime,
      uid: claims.user_id,
      email: claims.email || invitation.email || "",
      invitation,
      existingMember,
    });
    if (activation.conflict) {
      return json(invitationFailure("PASSWORD_MEMBER_CONFLICT", 409, "An existing member record contains privileged fields and was not modified. An administrator must reconcile the member record before activation."), 409);
    }
    return json({ ok: true, state: INVITATION_STATES.ACTIVATED, invitationId }, 200);
  } catch (error) {
    console.error("Invitation password-set failed", { stage: "PASSWORD_COMMIT", message: String(error?.message || error) });
    return json(invitationFailure("PASSWORD_COMMIT", 500, "Invitation activation could not be completed safely. No partial activation was committed."), 500);
  }
}

export const __test = {
  invitationExpiry,
  normalizeInvitationState,
  invitationFailure,
  TOKEN_TTL_MS,
};
