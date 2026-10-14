const API = "https://firestore.googleapis.com/v1/projects";
const IDENTITY = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";
const ACTIVE = new Set(["STARTING", "RECORDING", "STOPPING"]);
const CLOSED = new Set(["closed", "completed", "cancelled", "canceled", "archived"]);
const MODERATORS = new Set(["board chairperson", "board secretary", "chairperson", "meeting chair", "meeting secretary", "secretary"]);
const text = v => String(v == null ? "" : v).trim();
const lower = v => text(v).toLowerCase();
const now = () => Math.floor(Date.now() / 1000);

function error(status, code, message) {
  const e = new Error(message); e.status = status; e.code = code; return e;
}
function json(body, status, origin, headers = {}) {
  const h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin", ...headers };
  if (origin) Object.assign(h, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600" });
  return new Response(JSON.stringify(body), { status: status || 200, headers: h });
}
function allowedOrigin(origin) {
  return ["https://irpa-digital-board-governance.web.app", "https://irpa-digital-board-governance.firebaseapp.com", "https://irpa.or.tz", "https://www.irpa.or.tz"].includes(origin);
}
function enc(v) {
  if (v === null || v === undefined) return { nullValue: "NULL_VALUE" };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
  return { stringValue: String(v) };
}
function dec(v = {}) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
  return null;
}
const fields = obj => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, enc(v)]));
function base(env) { return API + "/" + encodeURIComponent(env.FIREBASE_PROJECT_ID) + "/databases/(default)/documents"; }
function docValue(d) { return d ? { id: String(d.name || "").split("/").pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, dec(v)])) } : null; }
async function getDoc(env, token, path) {
  const r = await fetch(base(env) + "/" + path, { headers: { Authorization: "Bearer " + token } });
  if (r.status === 404) return null;
  if (!r.ok) throw error(r.status === 403 ? 403 : 502, "FIRESTORE_READ_FAILED", r.status === 403 ? "Meeting data access was denied." : "Meeting data service unavailable.");
  return docValue(await r.json());
}
async function queryDocs(env, token, collection, field, value) {
  const r = await fetch(base(env) + ":runQuery", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: enc(value) } }, limit: 50 } })
  });
  if (!r.ok) throw error(r.status === 403 ? 403 : 502, "FIRESTORE_QUERY_FAILED", r.status === 403 ? "Meeting data access was denied." : "Meeting data service unavailable.");
  return (await r.json()).filter(x => x.document).map(x => docValue(x.document));
}
async function putDoc(env, token, path, data, createOnly = false) {
  const url = new URL(base(env) + "/" + path);
  if (createOnly) url.searchParams.set("currentDocument.exists", "false");
  const r = await fetch(url, { method: "PATCH", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ fields: fields(data) }) });
  if (!r.ok) throw error(r.status === 403 ? 403 : 502, "FIRESTORE_WRITE_FAILED", r.status === 403 ? "Meeting security rules rejected the recording update." : "Meeting record could not be saved.");
  return docValue(await r.json());
}
async function patchDoc(env, token, path, data) {
  const url = new URL(base(env) + "/" + path);
  Object.keys(data).forEach(k => url.searchParams.append("updateMask.fieldPaths", k));
  const r = await fetch(url, { method: "PATCH", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ fields: fields(data) }) });
  if (!r.ok) throw error(r.status === 403 ? 403 : 502, "FIRESTORE_WRITE_FAILED", r.status === 403 ? "Meeting security rules rejected the recording update." : "Meeting record could not be saved.");
  return docValue(await r.json());
}
async function audit(env, token, data) {
  await putDoc(env, token, "audit/" + crypto.randomUUID(), { ...data, createdAt: new Date() }, true);
}
async function userFromRequest(request, env) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") || "");
  if (!match) throw error(401, "AUTHENTICATION_REQUIRED", "Sign in to IRPA before opening the meeting room.");
  const idToken = match[1].trim();
  const r = await fetch(IDENTITY + "?key=" + encodeURIComponent(env.FIREBASE_WEB_API_KEY), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken })
  });
  const body = await r.json().catch(() => ({}));
  const user = body.users && body.users[0];
  if (!r.ok || !user || !user.localId) throw error(401, "INVALID_FIREBASE_ID_TOKEN", "Your IRPA session has expired. Sign in again.");
  return { uid: user.localId, email: lower(user.email), displayName: text(user.displayName), token: idToken };
}
function active(record = {}) {
  const status = lower(record.status || record.employmentStatus || record.registrationStatus);
  return !status || ["active", "activated", "current"].includes(status);
}
function roles(record = {}) {
  return [record.role, record.boardPosition, record.unit, record.unitName,
    ...(Array.isArray(record.roles) ? record.roles : []),
    ...(Array.isArray(record.assignedRoles) ? record.assignedRoles : []),
    ...(Array.isArray(record.selectedRoles) ? record.selectedRoles : []),
    ...(Array.isArray(record.roleAssignments) ? record.roleAssignments : [])
  ].flatMap(v => text(v).split(",")).map(v => v.trim()).filter(Boolean);
}
function listed(m = {}, uid, email) {
  if (["participantUids", "attendeeUids", "memberUids", "invitedUids", "subscriberUids"].some(k => Array.isArray(m[k]) && m[k].includes(uid))) return true;
  if (email && ["participantEmails", "attendeeEmails", "invitedEmails", "subscriberEmails"].some(k => Array.isArray(m[k]) && m[k].some(v => lower(v) === email))) return true;
  return ["participants", "attendees"].some(k => Array.isArray(m[k]) && m[k].some(p => text(p && (p.uid || p.userId || p.memberUid)) === uid));
}
function isOpen(m = {}) { return !CLOSED.has(lower(m.status || "Scheduled")); }
function isModerator(m, uid, email, authority) {
  return text(m.chairpersonUid) === uid || text(m.secretaryUid) === uid ||
    (email && lower(m.chairpersonEmail) === email) || (email && lower(m.secretaryEmail) === email) || MODERATORS.has(lower(authority));
}
async function roomName(meetingId) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(meetingId + ":shared-live-room"));
  return "irpa-meeting-" + Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
function b64url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function signJwt(claims, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const input = header + "." + payload;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return input + "." + b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input)));
}
async function livekit(env, method, payload) {
  const host = text(env.LIVEKIT_URL).replace(/^wss:/i, "https:").replace(/^ws:/i, "http:").replace(/\/+$/, "");
  const t = now();
  const token = await signJwt({ iss: env.LIVEKIT_API_KEY, sub: "irpa-livekit-control", nbf: t - 5, iat: t, exp: t + 60, video: { roomAdmin: true, roomCreate: true, roomRecord: true } }, env.LIVEKIT_API_SECRET);
  const r = await fetch(host + "/twirp/livekit.Egress/" + method, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw error(502, "LIVEKIT_EGRESS_REQUEST_FAILED", "LiveKit did not confirm the recording operation.");
  return body;
}
function egressName(info = {}) {
  const s = Number(info.status);
  return ({ 0: "EGRESS_STARTING", 1: "EGRESS_ACTIVE", 2: "EGRESS_ENDING", 3: "EGRESS_COMPLETE", 4: "EGRESS_FAILED", 5: "EGRESS_ABORTED", 6: "EGRESS_LIMIT_REACHED" })[s] || text(info.status) || "UNKNOWN";
}
function recState(info) {
  const s = egressName(info);
  if (s === "EGRESS_COMPLETE") return "COMPLETED";
  if (["EGRESS_FAILED", "EGRESS_ABORTED", "EGRESS_LIMIT_REACHED"].includes(s)) return "FAILED";
  if (s === "EGRESS_ENDING") return "STOPPING";
  if (s === "EGRESS_ACTIVE") return "RECORDING";
  return "STARTING";
}
function filesOf(info, outputPath) {
  const f = Array.isArray(info.file_results) ? info.file_results : Array.isArray(info.fileResults) ? info.fileResults : [];
  return f.map(x => ({ filename: text(x.filename) || outputPath.split("/").pop(), location: "gs://" + text(x.bucket || "") + "/" + outputPath, size: Number(x.size || 0) }));
}
async function context(env, user, meetingId, input = {}, allowClosed = false) {
  if (!meetingId) throw error(400, "MEETING_ID_REQUIRED", "Meeting ID is required.");
  const m = await getDoc(env, user.token, "meetings/" + encodeURIComponent(meetingId));
  if (!m) throw error(404, "MEETING_NOT_FOUND", "The requested meeting was not found.");
  if (!allowClosed && !isOpen(m)) throw error(409, "MEETING_CLOSED", "This meeting is closed and cannot accept media.");
  const p = await Promise.all([
    getDoc(env, user.token, "members/" + encodeURIComponent(user.uid)).catch(() => null),
    getDoc(env, user.token, "employees/" + encodeURIComponent(user.uid)).catch(() => null)
  ]);
  const profiles = p.filter(Boolean);
  let invite = null;
  if (text(input.participantId)) {
    invite = await getDoc(env, user.token, "participants/" + encodeURIComponent(text(input.participantId)));
    if (!invite || text(invite.meetingId) !== meetingId) throw error(403, "PARTICIPANT_NOT_VERIFIED", "The invited participant record could not be verified for this meeting.");
    const uid = text(invite.participantUid || invite.uid || invite.userId);
    const email = lower(invite.participantEmail || invite.email);
    if ((uid && uid !== user.uid) || (email && email !== user.email) || (!uid && !email)) throw error(403, "PARTICIPANT_IDENTITY_MISMATCH", "The invitation participant identity does not match the signed-in account.");
    if (["cancelled", "canceled", "revoked", "removed", "inactive", "closed"].includes(lower(invite.status))) throw error(403, "INVITATION_INACTIVE", "This meeting invitation is no longer active.");
  }
  const adminProfile = await getDoc(env, user.token, "adminProfiles/" + encodeURIComponent(user.uid)).catch(() => null);
  const isAdmin = user.email === "irpa2412@gmail.com" || adminProfile?.active === true;
  const inviteListed = Boolean(invite) || listed(m, user.uid, user.email);
  if (!isAdmin && !profiles.some(active) && !invite) throw error(403, "IDENTITY_NOT_ACTIVE", "An active IRPA identity or verified meeting invitee is required.");
  if (!isAdmin && !inviteListed) throw error(403, "MEETING_PARTICIPANT_REQUIRED", "This account is not registered as a participant in the selected meeting.");
  const authority = text(input.selectedAuthority);
  const profileRoles = profiles.flatMap(roles);
  const inviteRoles = invite ? [invite.role, invite.participantRole, invite.authority, ...(Array.isArray(invite.roles) ? invite.roles : [])].map(text).filter(Boolean) : [];
  if (!isAdmin && authority && !profileRoles.includes(authority) && !inviteRoles.includes(authority)) throw error(403, "AUTHORITY_NOT_REGISTERED", "The selected access authority is not registered to this account.");
  const moderatorRole = profileRoles.concat(inviteRoles).find(r => MODERATORS.has(lower(r))) || "";
  const controller = isAdmin || text(m.initiatorUid) === user.uid || text(m.createdByUid) === user.uid ||
    text(m.chairpersonUid) === user.uid || text(m.secretaryUid) === user.uid ||
    (user.email && lower(m.chairpersonEmail) === user.email) || (user.email && lower(m.secretaryEmail) === user.email) ||
    isModerator(m, user.uid, user.email, moderatorRole);
  return { meeting: m, meetingId, user, isAdmin, invited: Boolean(invite), controller, authority };
}
function requireStorage(env) {
  if (!text(env.LIVEKIT_URL) || !text(env.LIVEKIT_API_KEY) || !text(env.LIVEKIT_API_SECRET)) throw error(503, "LIVEKIT_NOT_CONFIGURED", "Production LiveKit credentials are not configured.");
  if (!text(env.LIVEKIT_RECORDING_BUCKET) || !text(env.LIVEKIT_RECORDING_GCP_CREDENTIALS_JSON)) throw error(503, "RECORDING_STORAGE_NOT_CONFIGURED", "Durable recording storage is not configured.");
}
async function startRecording(env, user, data) {
  requireStorage(env);
  const c = await context(env, user, text(data.meetingId), data);
  if (!c.controller) throw error(403, "RECORDING_CONTROL_DENIED", "Only the meeting initiator, chairperson, secretary, or authorised administrator may control recording.");
  if (c.meeting.recordingAllowed !== true) throw error(403, "RECORDING_NOT_AUTHORISED", "Recording is not enabled in the authoritative meeting record.");
  const old = await queryDocs(env, user.token, "meetingMediaRecordings", "meetingId", c.meetingId);
  if (old.some(r => ACTIVE.has(text(r.recordingStatus)))) throw error(409, "RECORDING_ALREADY_ACTIVE", "A recording is already active or stopping for this meeting.");
  try { JSON.parse(env.LIVEKIT_RECORDING_GCP_CREDENTIALS_JSON); } catch { throw error(503, "RECORDING_CREDENTIALS_INVALID", "Recording storage credentials are not valid JSON."); }
  const name = await roomName(c.meetingId);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeId = c.meetingId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
  const path = "irpa-governance-recordings/" + safeId + "/" + stamp + ".mp4";
  let e;
  try {
    e = await livekit(env, "StartRoomCompositeEgress", {
      room_name: name, layout: "grid", audio_only: false,
      file: { filepath: path, file_type: "MP4", gcp: { credentials: env.LIVEKIT_RECORDING_GCP_CREDENTIALS_JSON, bucket: env.LIVEKIT_RECORDING_BUCKET } }
    });
  } catch (e2) {
    await audit(env, user.token, { action: "LIVE_MEETING_RECORDING_START_FAILED", collection: "meetingMediaRecordings", recordId: null, details: { meetingId: c.meetingId, reason: text(e2.code || e2.message).slice(0, 160), storageDestination: "GOOGLE_CLOUD_STORAGE" }, actorUid: user.uid, actorEmail: user.email || null }).catch(() => {});
    throw e2;
  }
  const id = text(e.egress_id || e.egressId);
  if (!id) throw error(502, "EGRESS_ID_MISSING", "LiveKit did not return a recording identifier.");
  const state = recState(e);
  const row = {
    meetingId: c.meetingId, meetingReference: text(c.meeting.reference || c.meeting.title),
    meetingTitle: text(c.meeting.title), meetingCategory: text(c.meeting.meetingCategory || c.meeting.meetingPolicyId || "OTHER").toUpperCase(),
    roomName: name, egressId: id, outputPath: path, recordingStatus: state, egressStatus: egressName(e),
    recordingProvider: "LIVEKIT_EGRESS", storageDestination: "GOOGLE_CLOUD_STORAGE",
    startedByUid: user.uid, startedByEmail: user.email || null,
    startedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), fileResults: filesOf(e, path)
  };
  try {
    await putDoc(env, user.token, "meetingMediaRecordings/" + encodeURIComponent(id), row, true);
    await audit(env, user.token, { action: "LIVE_MEETING_RECORDING_STARTED", collection: "meetingMediaRecordings", recordId: id, details: { meetingId: c.meetingId, egressId: id, outputPath: path, recordingStatus: state, storageDestination: "GOOGLE_CLOUD_STORAGE" }, actorUid: user.uid, actorEmail: user.email || null });
  } catch (e3) {
    await livekit(env, "StopEgress", { egress_id: id }).catch(() => {});
    throw e3;
  }
  return { ok: true, recordingId: id, egressId: id, recordingStatus: state, outputPath: path, storageDestination: "GOOGLE_CLOUD_STORAGE" };
}
async function stopRecording(env, user, data) {
  requireStorage(env);
  const meetingId = text(data.meetingId), id = text(data.recordingId || data.egressId);
  if (!id) throw error(400, "RECORDING_ID_REQUIRED", "Recording ID is required.");
  const c = await context(env, user, meetingId, data, true);
  if (!c.controller) throw error(403, "RECORDING_CONTROL_DENIED", "Only the meeting initiator, chairperson, secretary, or authorised administrator may control recording.");
  const row = await getDoc(env, user.token, "meetingMediaRecordings/" + encodeURIComponent(id));
  if (!row || row.meetingId !== meetingId) throw error(404, "RECORDING_NOT_FOUND", "The recording does not belong to this meeting.");
  if (!ACTIVE.has(text(row.recordingStatus))) throw error(409, "RECORDING_NOT_ACTIVE", "This recording is not active.");
  let result;
  try { result = await livekit(env, "StopEgress", { egress_id: id }); }
  catch { throw error(502, "RECORDING_STOP_FAILED", "LiveKit did not confirm that recording stopped. The last verified status remains available."); }
  const state = recState(result), files = filesOf(result, row.outputPath);
  const changes = { recordingStatus: state, egressStatus: egressName(result), fileResults: files, stoppedByUid: user.uid, stoppedByEmail: user.email || null, stopRequestedAt: new Date(), updatedAt: new Date() };
  if (state === "COMPLETED") changes.completedAt = new Date();
  await patchDoc(env, user.token, "meetingMediaRecordings/" + encodeURIComponent(id), changes);
  await audit(env, user.token, { action: "LIVE_MEETING_RECORDING_STOP_REQUESTED", collection: "meetingMediaRecordings", recordId: id, details: { meetingId, recordingStatus: state, egressStatus: egressName(result), fileCount: files.length }, actorUid: user.uid, actorEmail: user.email || null });
  return { ok: true, recordingId: id, recordingStatus: state, egressStatus: egressName(result), files };
}
async function getRecordingStatus(env, user, data) {
  requireStorage(env);
  const c = await context(env, user, text(data.meetingId), data, true);
  const rows = await queryDocs(env, user.token, "meetingMediaRecordings", "meetingId", c.meetingId);
  rows.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
  let row = rows[0];
  if (!row) return { ok: true, recordingAllowed: c.meeting.recordingAllowed === true, recordingStatus: "NOT_STARTED", recording: null };
  if (row.egressId && ACTIVE.has(text(row.recordingStatus))) {
    try {
      const list = await livekit(env, "ListEgress", { egress_id: row.egressId });
      const current = (list.items || []).find(x => text(x.egress_id || x.egressId) === text(row.egressId));
      if (current) {
        const state = recState(current), files = filesOf(current, row.outputPath), changes = { recordingStatus: state, egressStatus: egressName(current), fileResults: files, updatedAt: new Date() };
        if (state === "COMPLETED") changes.completedAt = new Date();
        await patchDoc(env, user.token, "meetingMediaRecordings/" + encodeURIComponent(row.id), changes);
        row = { ...row, ...changes, recordingStatus: state, egressStatus: egressName(current), fileResults: files };
      }
    } catch { /* Preserve the last verified state during transient control-plane errors. */ }
  }
  const files = (Array.isArray(row.fileResults) ? row.fileResults : []).map(f => ({
    filename: text(f.filename) || text(row.outputPath).split("/").pop(),
    location: "/recording/download?meetingId=" + encodeURIComponent(c.meetingId) + "&recordingId=" + encodeURIComponent(row.egressId || row.id),
    size: Number(f.size || 0)
  }));
  return { ok: true, recordingAllowed: c.meeting.recordingAllowed === true, recordingStatus: row.recordingStatus || "UNKNOWN",
    recording: { id: row.id, egressId: row.egressId, outputPath: row.outputPath || null, status: row.recordingStatus || "UNKNOWN",
      egressStatus: row.egressStatus || null, startedAt: row.startedAt || null, stoppedAt: row.stopRequestedAt || null, files } };
}
function pemBytes(pem) {
  const s = String(pem || "").replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const raw = atob(s), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}
async function signRsa(claims, pem) {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })), body = b64url(JSON.stringify(claims)), input = head + "." + body;
  const key = await crypto.subtle.importKey("pkcs8", pemBytes(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  return input + "." + b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)));
}
async function storageAccessToken(credentials) {
  const t = now();
  const assertion = await signRsa({ iss: credentials.client_email, scope: "https://www.googleapis.com/auth/devstorage.read_only", aud: credentials.token_uri, iat: t, exp: t + 3600 }, credentials.private_key);
  const r = await fetch(credentials.token_uri, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || !b.access_token) throw error(502, "RECORDING_STORAGE_AUTH_FAILED", "Recording storage authorization failed.");
  return b.access_token;
}
async function download(request, env, user, url) {
  requireStorage(env);
  const meetingId = text(url.searchParams.get("meetingId")), id = text(url.searchParams.get("recordingId"));
  const c = await context(env, user, meetingId, {}, true);
  if (!id) throw error(400, "RECORDING_ID_REQUIRED", "Recording ID is required.");
  const row = await getDoc(env, user.token, "meetingMediaRecordings/" + encodeURIComponent(id));
  if (!row || row.meetingId !== meetingId) throw error(404, "RECORDING_NOT_FOUND", "The recording does not belong to this meeting.");
  if (!c.invited && !c.isAdmin && !c.controller && !listed(c.meeting, user.uid, user.email)) throw error(403, "RECORDING_DOWNLOAD_DENIED", "An authorised meeting participant is required.");
  if (text(row.recordingStatus) !== "COMPLETED" || !text(row.outputPath)) throw error(409, "RECORDING_NOT_READY", "The recording file is not complete and available yet.");
  const creds = JSON.parse(env.LIVEKIT_RECORDING_GCP_CREDENTIALS_JSON), access = await storageAccessToken(creds);
  const target = "https://storage.googleapis.com/storage/v1/b/" + encodeURIComponent(env.LIVEKIT_RECORDING_BUCKET) + "/o/" + encodeURIComponent(row.outputPath) + "?alt=media";
  const file = await fetch(target, { headers: { Authorization: "Bearer " + access } });
  if (!file.ok) throw error(file.status === 404 ? 404 : 502, file.status === 404 ? "RECORDING_FILE_NOT_FOUND" : "RECORDING_DOWNLOAD_FAILED",
    file.status === 404 ? "The completed recording is not in storage yet. Refresh the status and retry." : "The recording could not be retrieved from controlled storage.");
  const filename = text(row.outputPath).split("/").pop().replace(/["\\]/g, "_");
  const headers = { "Content-Type": file.headers.get("Content-Type") || "video/mp4", "Content-Disposition": 'attachment; filename="' + filename + '"', "Cache-Control": "private, no-store", "Vary": "Origin" };
  if (file.headers.get("Content-Length")) headers["Content-Length"] = file.headers.get("Content-Length");
  headers["Access-Control-Allow-Origin"] = request.headers.get("Origin") || "";
  headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
  return new Response(file.body, { status: 200, headers });
}
async function route(request, env, origin) {
  const url = new URL(request.url);
  if (request.method === "GET" && ["/", "/health", "/__irpa_health"].includes(url.pathname)) {
    return json({ ok: true, service: "IRPA LiveKit production token and recording service", environment: "production",
      tokenConfigured: Boolean(text(env.LIVEKIT_URL) && text(env.LIVEKIT_API_KEY) && text(env.LIVEKIT_API_SECRET)),
      recordingStorageConfigured: Boolean(text(env.LIVEKIT_RECORDING_BUCKET) && text(env.LIVEKIT_RECORDING_GCP_CREDENTIALS_JSON)) }, 200, origin);
  }
  if (request.method !== "POST" && !(request.method === "GET" && url.pathname === "/recording/download")) return json({ ok: false, error: "NOT_FOUND" }, 404, origin);
  const user = await userFromRequest(request, env);
  if (request.method === "POST") {
    const data = await request.json().catch(() => null);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw error(400, "INVALID_JSON", "A valid JSON request body is required.");
    if (url.pathname === "/token") {
      if (!text(env.LIVEKIT_URL) || !text(env.LIVEKIT_API_KEY) || !text(env.LIVEKIT_API_SECRET)) throw error(503, "LIVEKIT_NOT_CONFIGURED", "Production LiveKit credentials are not configured.");
      const c = await context(env, user, text(data.meetingId), data), name = await roomName(c.meetingId), issued = now();
      const moderator = c.isAdmin || isModerator(c.meeting, c.user.uid, c.user.email, c.authority);
      const participantToken = await signJwt({ iss: env.LIVEKIT_API_KEY, sub: "uid-" + user.uid,
        name: text(c.meeting.displayName || c.meeting.title || user.displayName || "IRPA participant"),
        nbf: issued - 5, iat: issued, exp: issued + 600,
        video: { roomJoin: true, room: name, canPublish: true, canSubscribe: true, canPublishData: true, roomAdmin: moderator } }, env.LIVEKIT_API_SECRET);
      const sessionId = crypto.randomUUID();
      await audit(env, user.token, { action: "LIVE_MEETING_TOKEN_ISSUED", collection: "liveMeetingSessions", recordId: sessionId,
        details: { meetingId: c.meetingId, roomName: name, participantUid: user.uid, participantAuthority: c.authority || "Meeting Participant",
          moderator, recordingPolicy: c.meeting.recordingAllowed === true ? "Allowed by meeting record" : "Not enabled", tokenTtl: "10m", mediaEngine: "LiveKit" },
        actorUid: user.uid, actorEmail: user.email || null });
      return json({ ok: true, sessionId, serverUrl: env.LIVEKIT_URL, participantToken, moderator, recordingAllowed: c.meeting.recordingAllowed === true, expiresInSeconds: 600 }, 200, origin);
    }
    if (url.pathname === "/recording/start") return json(await startRecording(env, user, data), 200, origin);
    if (url.pathname === "/recording/stop") return json(await stopRecording(env, user, data), 200, origin);
    if (url.pathname === "/recording/status") return json(await getRecordingStatus(env, user, data), 200, origin);
    return json({ ok: false, error: "NOT_FOUND" }, 404, origin);
  }
  if (url.pathname === "/recording/download") return download(request, env, user, url);
  return json({ ok: false, error: "NOT_FOUND" }, 404, origin);
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (!allowedOrigin(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600", "Vary": "Origin" } });
    }
    if (origin && !allowedOrigin(origin)) return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403, "");
    try { return await route(request, env, origin); }
    catch (e) {
      const s = Number(e.status || 500), code = text(e.code) || "INTERNAL_ERROR";
      const message = s >= 500 && !e.status ? "The meeting media service encountered an internal error." : text(e.message) || "The request could not be completed.";
      return json({ ok: false, error: code, message }, s, origin);
    }
  }
};
export const _test = { enc, dec, roles, listed, isOpen, isModerator, egressName, recState, allowedOrigin, roomName, signJwt };
