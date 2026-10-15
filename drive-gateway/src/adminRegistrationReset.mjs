const RECOVERY_OPERATOR_EMAIL = "irpa2412@gmail.com";
const RESET_CONFIRMATION = "RESET ADMIN REGISTRATION ONLY";
const MAX_AUTH_AGE_SECONDS = 10 * 60;
const PRESERVED_COLLECTIONS = [
  "members", "employees", "meetings", "meetingSubscriptions", "meetingRoomEvents",
  "transcriptions", "resolutions", "votes", "documents", "signatures",
  "signatureEnvelopes", "signatureEvents", "signerIdentities", "financeTransactions",
  "financeBudgets", "financeReports", "financeLedgerEntries", "audit"
];

function errorResponse(json, corsHeaders, request, status, message) {
  return json({ ok: false, error: message }, status, corsHeaders(request));
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let diff = a.length ^ b.length;
  const size = Math.max(a.length, b.length);
  for (let i = 0; i < size; i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function fieldValue(field) {
  if (!field) return null;
  if ("stringValue" in field) return field.stringValue;
  if ("booleanValue" in field) return field.booleanValue;
  if ("integerValue" in field) return Number(field.integerValue);
  if ("timestampValue" in field) return field.timestampValue;
  if ("arrayValue" in field) return (field.arrayValue.values || []).map(fieldValue);
  return null;
}

function documentFields(document) {
  return Object.fromEntries(Object.entries(document?.fields || {}).map(([key, value]) => [key, fieldValue(value)]));
}

function makeEvent({ operationId, targetUid, actor, reason, profileExisted, profileChanged }) {
  return {
    operation: "ADMIN_REGISTRATION_RESET",
    operationId,
    targetUid,
    actorUid: actor.uid,
    actorEmail: actor.email,
    reason,
    scope: "adminProfiles/" + targetUid + "/active",
    profileExisted,
    profileChanged,
    preservedCollections: PRESERVED_COLLECTIONS
  };
}

function firestoreFields(event, eventHash) {
  const fields = {};
  for (const [key, value] of Object.entries(event)) {
    if (Array.isArray(value)) fields[key] = { arrayValue: { values: value.map(stringValue => ({ stringValue })) } };
    else if (typeof value === "boolean") fields[key] = { booleanValue: value };
    else fields[key] = { stringValue: String(value) };
  }
  fields.action = { stringValue: "ADMIN_REGISTRATION_RESET" };
  fields.collection = { stringValue: "adminProfiles" };
  fields.recordId = { stringValue: event.targetUid };
  fields.eventHash = { stringValue: eventHash };
  fields.createdAt = { timestampValue: new Date().toISOString() };
  return fields;
}

function validPriorAudit(document, expected) {
  if (!document?.fields) return false;
  const prior = documentFields(document);
  const event = makeEvent({
    operationId: expected.operationId,
    targetUid: expected.targetUid,
    actor: expected.actor,
    reason: expected.reason,
    profileExisted: prior.profileExisted === true,
    profileChanged: prior.profileChanged === true
  });
  return prior.operation === event.operation &&
    prior.operationId === event.operationId &&
    prior.targetUid === event.targetUid &&
    prior.actorUid === event.actorUid &&
    prior.actorEmail === event.actorEmail &&
    prior.reason === event.reason &&
    prior.scope === event.scope &&
    prior.action === "ADMIN_REGISTRATION_RESET" &&
    prior.collection === "adminProfiles" &&
    prior.recordId === event.targetUid &&
    prior.eventHash === expected.eventHashIfPrior ||
    false;
}

async function priorAuditMatches(document, expected) {
  if (!document?.fields) return false;
  const prior = documentFields(document);
  const event = makeEvent({
    operationId: expected.operationId,
    targetUid: expected.targetUid,
    actor: expected.actor,
    reason: expected.reason,
    profileExisted: prior.profileExisted === true,
    profileChanged: prior.profileChanged === true
  });
  if (
    prior.operation !== event.operation ||
    prior.operationId !== event.operationId ||
    prior.targetUid !== event.targetUid ||
    prior.actorUid !== event.actorUid ||
    prior.actorEmail !== event.actorEmail ||
    prior.reason !== event.reason ||
    prior.scope !== event.scope ||
    prior.action !== "ADMIN_REGISTRATION_RESET" ||
    prior.collection !== "adminProfiles" ||
    prior.recordId !== event.targetUid ||
    !Array.isArray(prior.preservedCollections) ||
    prior.preservedCollections.join("|") !== PRESERVED_COLLECTIONS.join("|")
  ) return false;
  return prior.eventHash === await sha256Hex(event);
}

export async function commitFirestoreWrites({ projectId, token, writes, fetchImpl = fetch }) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes })
  });
  if (!response.ok) {
    const error = new Error("Firestore rejected the administrator registration recovery commit.");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function handleAdminRegistrationReset(request, env, deps) {
  const { authenticate, getFirestoreDocument, getFirebaseProjectId, json, corsHeaders, commitWrites = commitFirestoreWrites } = deps;
  if (env.ADMIN_REGISTRATION_RESET_ENABLED !== "true") {
    return errorResponse(json, corsHeaders, request, 404, "Not found.");
  }
  if (request.method !== "POST") return errorResponse(json, corsHeaders, request, 405, "Method not allowed.");
  if (Number(request.headers.get("content-length") || 0) > 16384) {
    return errorResponse(json, corsHeaders, request, 413, "Request is too large.");
  }

  let claims;
  try {
    claims = await authenticate(request, env, { skipActivation: true });
  } catch {
    return errorResponse(json, corsHeaders, request, 401, "Valid Firebase authentication is required.");
  }
  const actor = {
    uid: String(claims?.user_id || "").trim(),
    email: String(claims?.email || "").trim().toLowerCase()
  };
  if (!actor.uid) return errorResponse(json, corsHeaders, request, 401, "Valid Firebase authentication is required.");
  if (actor.email !== RECOVERY_OPERATOR_EMAIL) {
    return errorResponse(json, corsHeaders, request, 403, "This account is not the designated recovery operator.");
  }

  const authTime = Number(claims.auth_time || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authTime) || authTime <= 0 || authTime > now + 30 || now - authTime > MAX_AUTH_AGE_SECONDS) {
    return errorResponse(json, corsHeaders, request, 403, "Recent re-authentication is required.");
  }

  const expectedSecret = String(env.IRPA_RESET_DEVELOPER_SECRET || "");
  const suppliedSecret = String(request.headers.get("x-irpa-reset-secret") || "");
  if (!/^[a-fA-F0-9]{64}$/.test(expectedSecret) || !/^[a-fA-F0-9]{64}$/.test(suppliedSecret) || !constantTimeEqual(expectedSecret.toLowerCase(), suppliedSecret.toLowerCase())) {
    return errorResponse(json, corsHeaders, request, 403, "Reset authorization was not accepted.");
  }

  let data;
  try { data = await request.json(); } catch {
    return errorResponse(json, corsHeaders, request, 400, "A valid JSON request is required.");
  }
  const targetUid = String(data?.targetUid || "").trim();
  const operationId = String(data?.operationId || "").trim().toLowerCase();
  const confirmation = String(data?.confirmation || "");
  const reason = String(data?.reason || "").trim();
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(targetUid)) return errorResponse(json, corsHeaders, request, 400, "A valid target administrator UID is required.");
  if (targetUid === actor.uid) return errorResponse(json, corsHeaders, request, 403, "The recovery operator cannot reset their own registration.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId)) return errorResponse(json, corsHeaders, request, 400, "A unique version-4 operation ID is required.");
  if (confirmation !== RESET_CONFIRMATION) return errorResponse(json, corsHeaders, request, 400, "Explicit reset confirmation did not match.");
  if (reason.length < 20 || reason.length > 500) return errorResponse(json, corsHeaders, request, 400, "Provide a reset reason between 20 and 500 characters.");

  const projectId = getFirebaseProjectId(env);
  const auditId = "admin-registration-reset-" + operationId;
  const auditPath = "audit/" + auditId;
  const targetPath = "adminProfiles/" + targetUid;
  const expected = { operationId, targetUid, actor, reason };

  try {
    const auditBefore = await getFirestoreDocument(env, auditPath, claims.token);
    if (auditBefore) {
      if (!await priorAuditMatches(auditBefore, expected)) {
        return errorResponse(json, corsHeaders, request, 409, "Operation ID reuse or audit-integrity failure; no changes were made.");
      }
      return json({ ok: true, operationId, status: "ALREADY_APPLIED", targetUid, profileChanged: documentFields(auditBefore).profileChanged === true, eventHash: documentFields(auditBefore).eventHash }, 200, corsHeaders(request));
    }

    const target = await getFirestoreDocument(env, targetPath, claims.token);
    const profileExisted = Boolean(target?.fields);
    const profileChanged = target?.fields?.active?.booleanValue === true;
    const event = makeEvent({ ...expected, profileExisted, profileChanged });
    const eventHash = await sha256Hex(event);
    const base = `projects/${projectId}/databases/(default)/documents`;
    const writes = [];
    if (profileChanged) {
      if (!target.updateTime) return errorResponse(json, corsHeaders, request, 409, "Target profile version could not be verified; no changes were made.");
      writes.push({
        update: { name: `${base}/adminProfiles/${targetUid}`, fields: { active: { booleanValue: false } } },
        updateMask: { fieldPaths: ["active"] },
        currentDocument: { updateTime: target.updateTime }
      });
    }
    writes.push({
      update: { name: `${base}/audit/${auditId}`, fields: firestoreFields(event, eventHash) },
      currentDocument: { exists: false }
    });

    try {
      await commitWrites({ projectId, token: claims.token, writes });
    } catch {
      const auditAfterRace = await getFirestoreDocument(env, auditPath, claims.token).catch(() => null);
      if (await priorAuditMatches(auditAfterRace, expected)) {
        const prior = documentFields(auditAfterRace);
        return json({ ok: true, operationId, status: "ALREADY_APPLIED", targetUid, profileChanged: prior.profileChanged === true, eventHash: prior.eventHash }, 200, corsHeaders(request));
      }
      return errorResponse(json, corsHeaders, request, 409, "Recovery could not be committed safely; verify audit state before retrying.");
    }

    return json({ ok: true, operationId, status: "COMPLETED", targetUid, profileChanged, eventHash }, 200, corsHeaders(request));
  } catch {
    return errorResponse(json, corsHeaders, request, 503, "Administrator recovery could not be completed. No secret material was logged.");
  }
}

export const ADMIN_RESET_CONFIRMATION = RESET_CONFIRMATION;
export const ADMIN_RESET_OPERATOR_EMAIL = RECOVERY_OPERATOR_EMAIL;
