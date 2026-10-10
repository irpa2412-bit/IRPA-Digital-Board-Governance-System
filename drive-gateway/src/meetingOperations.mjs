const clean = value => String(value ?? "").trim();
const lower = value => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const sha256 = async value => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
};
const base64url = value => btoa(String.fromCharCode(...new TextEncoder().encode(value))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const firestoreValue = value => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, firestoreValue(v)])) } };
  return { stringValue: String(value) };
};
const firestoreFields = value => Object.fromEntries(Object.entries(value).map(([k, v]) => [k, firestoreValue(v)]));
function plain(doc) {
  if (!doc?.fields) return null;
  const read = v => {
    if (!v) return null;
    if ("stringValue" in v) return v.stringValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return v.doubleValue;
    if ("timestampValue" in v) return v.timestampValue;
    if ("nullValue" in v) return null;
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(read);
    if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, read(x)]));
    return null;
  };
  return { id: String(doc.name || "").split("/").pop(), ...Object.fromEntries(Object.entries(doc.fields).map(([k, v]) => [k, read(v)])) };
}
function jsonError(ctx, req, message, status = 400) {
  return ctx.json({ ok: false, error: message }, status, ctx.corsHeaders(req));
}
async function firestore(ctx, env, token, path, init = {}) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${ctx.getFirebaseProjectId(env)}/databases/(default)/documents/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Firestore request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return body;
}
async function getDoc(ctx, env, token, collection, id) {
  try { return await firestore(ctx, env, token, `${collection}/${encodeURIComponent(id)}`); }
  catch (error) { if (error.status === 404) return null; throw error; }
}
async function queryDocs(ctx, env, token, collection, field, value, limit = 500) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${ctx.getFirebaseProjectId(env)}/databases/(default)/documents:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: firestoreValue(value) } }, limit } })
  });
  const body = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Firestore query failed (${response.status}).`);
  return (Array.isArray(body) ? body : []).map(row => plain(row.document)).filter(Boolean);
}
async function putDoc(ctx, env, token, collection, id, data, merge = false) {
  const path = `${collection}/${encodeURIComponent(id)}`;
  const mask = Object.keys(data).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  return firestore(ctx, env, token, merge ? `${path}?${mask}` : `${path}?updateMask.fieldPaths=${Object.keys(data).map(encodeURIComponent).join("&updateMask.fieldPaths=")}`, {
    method: "PATCH", body: JSON.stringify({ fields: firestoreFields(data) })
  });
}
async function addDoc(ctx, env, token, collection, data, id = "") {
  const suffix = id ? `?documentId=${encodeURIComponent(id)}` : "";
  return firestore(ctx, env, token, `${collection}${suffix}`, { method: "POST", body: JSON.stringify({ fields: firestoreFields(data) }) });
}
async function audit(ctx, env, token, actor, action, collection, recordId, details = {}) {
  await addDoc(ctx, env, token, "audit", {
    action, collection, recordId: recordId || null, details, actorUid: actor.uid,
    actorEmail: actor.email || null, createdAt: new Date()
  });
}
const categoryOf = meeting => {
  const raw = clean(meeting.meetingCategory || meeting.meetingPolicyId || meeting.category || meeting.meetingType).toUpperCase();
  if (["GOVERNANCE", "BOARD", "BOARD MEETING", "BOARD COMMITTEE MEETING", "ANNUAL GENERAL MEETING", "SPECIAL MEETING"].includes(raw)) return "GOVERNANCE";
  if (["ADMINISTRATIVE", "MANAGEMENT", "MANAGEMENT MEETING", "ADMINISTRATION MEETING", "OPERATIONS MEETING"].includes(raw)) return "ADMINISTRATIVE";
  if (["STAFF", "STAFF MEETING"].includes(raw)) return "STAFF";
  if (["GENERAL", "GENERAL MEETING"].includes(raw)) return "GENERAL";
  return "OTHER";
};
const retentionYears = category => ({ GOVERNANCE: 7, ADMINISTRATIVE: 5, STAFF: 3, GENERAL: 3, OTHER: 3 })[category] || 3;
const addYears = (date, years) => { const result = new Date(date); result.setUTCFullYear(result.getUTCFullYear() + years); return result; };
const recordLabel = type => ({
  TRANSCRIPT: "Meeting Transcript", MINUTES_DRAFT: "Draft Minutes", MINUTES_FINAL: "Approved / Final Minutes",
  AI_MINUTES_DRAFT: "AI-Assisted Draft Minutes", AI_SUMMARY_DRAFT: "AI-Assisted Meeting Summary Draft",
  SUBSCRIBER_TRANSCRIPT_DRAFT: "Subscriber Proceedings Draft", DECISION_REGISTER: "Decision Register",
  ATTENDANCE_REGISTER: "Attendance Register", MEETING_REPORT: "Compiled Meeting Report", OTHER: "Other Meeting Record"
})[type] || "Meeting Record";
const isClosed = status => ["completed", "closed", "cancelled", "canceled", "archived"].includes(lower(status));
async function meetingContext(ctx, env, token, claims, meetingId) {
  const uid = clean(claims.user_id), email = lower(claims.email);
  if (!uid || !meetingId) throw Object.assign(new Error("Sign in and provide a meeting ID."), { status: 400 });
  const meetingDoc = await getDoc(ctx, env, token, "meetings", meetingId);
  if (!meetingDoc) throw Object.assign(new Error("Meeting record not found."), { status: 404 });
  const meeting = plain(meetingDoc);
  const [adminDoc, memberDoc, employeeDoc, participants, subscriptions] = await Promise.all([
    getDoc(ctx, env, token, "adminProfiles", uid),
    getDoc(ctx, env, token, "members", uid),
    getDoc(ctx, env, token, "employees", uid),
    queryDocs(ctx, env, token, "participants", "meetingId", meetingId).catch(() => []),
    queryDocs(ctx, env, token, "meetingSubscriptions", "meetingId", meetingId).catch(() => [])
  ]);
  const activeAdmin = claims.admin === true || email === "irpa2412@gmail.com" || plain(adminDoc)?.active === true;
  const activeMember = ["active", "activated"].includes(lower(plain(memberDoc)?.status || plain(memberDoc)?.registrationStatus));
  const activeEmployee = ["active", "activated"].includes(lower(plain(employeeDoc)?.status || plain(employeeDoc)?.employmentStatus || plain(employeeDoc)?.registrationStatus));
  const controller = activeAdmin || clean(meeting.initiatorUid) === uid || clean(meeting.createdByUid) === uid ||
    clean(meeting.chairpersonUid) === uid || clean(meeting.secretaryUid) === uid ||
    lower(meeting.chairpersonEmail) === email || lower(meeting.secretaryEmail) === email;
  const listed = [meeting.participantUids, meeting.attendeeUids, meeting.memberUids, meeting.invitedUids, meeting.subscriberUids]
    .some(list => Array.isArray(list) && list.map(String).includes(uid)) ||
    [meeting.participantEmails, meeting.attendeeEmails, meeting.invitedEmails, meeting.subscriberEmails]
      .some(list => Array.isArray(list) && list.map(lower).includes(email));
  const participant = listed || participants.some(p => !["cancelled", "canceled", "revoked", "removed", "inactive", "closed"].includes(lower(p.status || p.registrationStatus)) &&
      [p.uid, p.userId, p.participantUid, p.memberUid, p.invitedUid].map(String).includes(uid) ||
      (email && [p.email, p.participantEmail, p.invitedEmail].some(v => lower(v) === email))) ||
    subscriptions.some(s => !["cancelled", "canceled", "revoked", "removed", "inactive", "closed"].includes(lower(s.status)) &&
      ([s.uid, s.subscriberUid, s.userId, s.memberUid, s.participantUid].map(String).includes(uid) || (email && [s.email, s.subscriberEmail, s.participantEmail].some(v => lower(v) === email))));
  const canRead = controller || participant || activeMember || activeEmployee;
  if (!canRead) throw Object.assign(new Error("An active IRPA identity or authorised meeting participant is required."), { status: 403 });
  return { uid, email, meeting, category: categoryOf(meeting), controller, canRead, admin: activeAdmin, confidentiality: clean(meeting.confidentialityClass) || (categoryOf(meeting) === "GOVERNANCE" ? "BOARD_RESTRICTED" : "INTERNAL") };
}
async function signedLiveKitJwt(env, identity, grants, ttlSeconds = 600) {
  const key = clean(env.LIVEKIT_API_KEY), secret = clean(env.LIVEKIT_API_SECRET);
  if (!key || !secret || !clean(env.LIVEKIT_URL)) throw Object.assign(new Error("LiveKit is not configured in Cloudflare Worker secrets."), { status: 503 });
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ iss: key, sub: identity, nbf: now - 5, iat: now, exp: now + ttlSeconds, video: grants }));
  const data = `${header}.${payload}`;
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return `${data}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
async function liveKitRequest(env, path, body) {
  const host = clean(env.LIVEKIT_URL).replace(/^wss:/i, "https:").replace(/^ws:/i, "http:").replace(/\/$/, "");
  const token = await signedLiveKitJwt(env, "irpa-dbgs-worker", { roomRecord: true, roomAdmin: true, roomList: true, roomCreate: true }, 300);
  const response = await fetch(`${host}/twirp/livekit.Egress/${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || `LiveKit egress request failed (${response.status}).`), { status: response.status });
  return data;
}
function opaqueRoomName(meetingId) { return `irpa-${meetingId}-${"shared"}`; }
export function createMeetingOperationsRouter(ctx) {
  const routes = new Map([
    ["/api/meeting-records/capture", "capture"], ["/api/meeting-records/draft", "draft"],
    ["/api/meeting-records/list", "list"], ["/api/meeting-records/retrieve", "retrieve"],
    ["/api/meeting-records/protection", "protection"], ["/api/meeting-records/dispose", "dispose"],
    ["/api/meeting-proceedings/save", "proceedings"], ["/api/meeting-transcripts/translate", "translate"],
    ["/api/meeting-reports/compile-email", "report"], ["/api/meeting-media/token", "mediaToken"],
    ["/api/meeting-media/recording/start", "recordingStart"], ["/api/meeting-media/recording/stop", "recordingStop"],
    ["/api/meeting-media/recording/status", "recordingStatus"]
  ]);
  return async function meetingOperationsRouter(request, env, pathname) {
    const action = routes.get(pathname);
    if (!action || request.method !== "POST") return null;
    let claims;
    try { claims = await ctx.authenticateFirebaseRequest(request, env); }
    catch (error) {
      const authError = /authentication is required|invalid firebase|firebase token is expired|signing key not found/i.test(String(error?.message || ""));
      return jsonError(ctx, request, authError ? "A valid IRPA sign-in is required." : "Your portal session could not be verified.", authError ? 401 : 503);
    }
    let data;
    try { data = await request.json(); } catch { return jsonError(ctx, request, "A valid JSON request is required.", 400); }
    const token = await ctx.getFirestoreAdminAccessToken(env).catch(() => null);
    if (!token) return jsonError(ctx, request, "Meeting services are temporarily unavailable because the server identity is not configured.", 503);
    const actor = { uid: clean(claims.user_id), email: lower(claims.email) };
    try {
      if (action === "mediaToken") {
        const state = await meetingContext(ctx, env, token, claims, clean(data.meetingId));
        if (isClosed(state.meeting.status)) return jsonError(ctx, request, "This meeting is closed for live media.", 409);
        const roomName = `irpa-${(await sha256(state.meeting.id)).slice(0, 32)}`;
        const participantId = actor.uid;
        const tokenValue = await signedLiveKitJwt(env, participantId, { roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true, roomAdmin: state.controller }, 3600);
        await audit(ctx, env, token, actor, "LIVE_MEETING_TOKEN_ISSUED", "meetings", state.meeting.id, { roomName, moderator: state.controller, mediaEngine: "LiveKit" });
        return ctx.json({ ok: true, token: tokenValue, serverUrl: clean(env.LIVEKIT_URL), roomName, meetingId: state.meeting.id, mediaEngine: "LiveKit", expiresInSeconds: 3600 }, 200, ctx.corsHeaders(request));
      }
      if (action === "recordingStart" || action === "recordingStop" || action === "recordingStatus") {
        const state = await meetingContext(ctx, env, token, claims, clean(data.meetingId));
        if (!state.controller) return jsonError(ctx, request, "Only the meeting administrator, initiator, chairperson or secretary may control recording.", 403);
        if (action === "recordingStart") {
          if (isClosed(state.meeting.status)) return jsonError(ctx, request, "Recording cannot start for a closed meeting.", 409);
          let output;
          try { output = JSON.parse(String(env.LIVEKIT_EGRESS_OUTPUT || "")); } catch { output = null; }
          if (!output || typeof output !== "object" || Array.isArray(output)) return jsonError(ctx, request, "LiveKit recording storage is not configured. Set LIVEKIT_EGRESS_OUTPUT in the Worker secret/configuration before starting a recording.", 503);
          const roomName = `irpa-${(await sha256(state.meeting.id)).slice(0, 32)}`;
          const response = await liveKitRequest(env, "StartRoomCompositeEgress", { room_name: roomName, layout: "grid", audio_only: false, video_only: false, ...output });
          const egressId = clean(response.egress_id || response.egressId);
          if (!egressId) return jsonError(ctx, request, "LiveKit did not return a recording identifier; no recording has been confirmed.", 502);
          const row = { meetingId: state.meeting.id, meetingCategory: state.category, egressId, roomName, status: "ACTIVE", recordingProvider: "LIVEKIT_EGRESS", storageDestination: "LIVEKIT_EGRESS_CONFIGURED_STORAGE", startedByUid: actor.uid, startedAt: new Date(), updatedAt: new Date(), response };
          await putDoc(ctx, env, token, "meetingMediaRecordings", egressId, row);
          await audit(ctx, env, token, actor, "LIVE_MEETING_RECORDING_STARTED", "meetingMediaRecordings", egressId, { meetingId: state.meeting.id, roomName });
          return ctx.json({ ok: true, recordingId: egressId, status: "ACTIVE", storageDestination: row.storageDestination }, 200, ctx.corsHeaders(request));
        }
        if (action === "recordingStop") {
          const recordingId = clean(data.recordingId);
          if (!recordingId) return jsonError(ctx, request, "Recording ID is required to stop a recording.", 400);
          const recordingDoc = await getDoc(ctx, env, token, "meetingMediaRecordings", recordingId);
          const recording = plain(recordingDoc);
          if (!recording || recording.meetingId !== state.meeting.id) return jsonError(ctx, request, "Recording does not belong to this meeting.", 404);
          const response = await liveKitRequest(env, "StopEgress", { egress_id: recordingId });
          await putDoc(ctx, env, token, "meetingMediaRecordings", recordingId, { status: "STOP_REQUESTED", stoppedByUid: actor.uid, stopRequestedAt: new Date(), updatedAt: new Date(), stopResponse: response }, true);
          await audit(ctx, env, token, actor, "LIVE_MEETING_RECORDING_STOP_REQUESTED", "meetingMediaRecordings", recordingId, { meetingId: state.meeting.id });
          return ctx.json({ ok: true, recordingId, status: "STOP_REQUESTED", response }, 200, ctx.corsHeaders(request));
        }
        const rows = await queryDocs(ctx, env, token, "meetingMediaRecordings", "meetingId", state.meeting.id);
        const current = rows.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")))[0] || null;
        if (!current) return ctx.json({ ok: true, recording: null, status: "NOT_STARTED" }, 200, ctx.corsHeaders(request));
        let liveStatus = null;
        try { liveStatus = await liveKitRequest(env, "ListEgress", { egress_id: current.egressId }); } catch (error) { liveStatus = { unavailable: true, error: String(error.message || error).slice(0, 160) }; }
        return ctx.json({ ok: true, recording: current, status: current.status, liveKitStatus: liveStatus }, 200, ctx.corsHeaders(request));
      }
      if (action === "translate") {
        const state = await meetingContext(ctx, env, token, claims, clean(data.meetingId));
        if (!state.canRead) return jsonError(ctx, request, "You are not authorised to translate these proceedings.", 403);
        const content = clean(data.content), targetLanguage = lower(data.targetLanguage);
        if (!content || content.length > 150000 || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(targetLanguage)) return jsonError(ctx, request, "Transcript content and a valid target language are required.", 400);
        if (!clean(env.GOOGLE_TRANSLATE_API_KEY)) return jsonError(ctx, request, "Transcript translation is not configured in the Cloudflare Worker. Configure GOOGLE_TRANSLATE_API_KEY before retrying.", 503);
        const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(env.GOOGLE_TRANSLATE_API_KEY)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: content, target: targetLanguage, format: "text" }) });
        const result = await response.json().catch(() => ({}));
        const translatedText = clean(result?.data?.translations?.[0]?.translatedText);
        if (!response.ok || !translatedText) return jsonError(ctx, request, "Google Cloud Translation did not return a usable translation.", 502);
        await audit(ctx, env, token, actor, "MEETING_TRANSCRIPT_TRANSLATED", "meetingRecords", null, { meetingId: state.meeting.id, targetLanguage, sourceCharacters: content.length, translatedCharacters: translatedText.length, requiresHumanReview: true });
        return ctx.json({ ok: true, translatedText, targetLanguage, provider: "Google Cloud Translation", requiresHumanReview: true }, 200, ctx.corsHeaders(request));
      }
      if (action === "report") {
        const state = await meetingContext(ctx, env, token, claims, clean(data.meetingId));
        if (!state.controller) return jsonError(ctx, request, "Only the authorised meeting initiator, chairperson, secretary or administrator may compile and distribute the report.", 403);
        if (!clean(state.meeting.registerStatus)) return jsonError(ctx, request, "The meeting is not registered and cannot be reported.", 409);
        const minutes = clean(data.minutesText);
        if (minutes.length > 150000) return jsonError(ctx, request, "Compiled minutes exceed the 150,000 character limit.", 400);
        const [participants, subscriptions, resolutions, decisions, votes] = await Promise.all([
          queryDocs(ctx, env, token, "participants", "meetingId", state.meeting.id).catch(() => []),
          queryDocs(ctx, env, token, "meetingSubscriptions", "meetingId", state.meeting.id).catch(() => []),
          queryDocs(ctx, env, token, "resolutions", "meetingId", state.meeting.id).catch(() => []),
          queryDocs(ctx, env, token, "decisions", "meetingId", state.meeting.id).catch(() => []),
          queryDocs(ctx, env, token, "votes", "meetingId", state.meeting.id).catch(() => [])
        ]);
        const recipients = new Map();
        const addRecipient = (address, name = "", status = "") => { const email = lower(address); if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !["cancelled","canceled","revoked","removed","inactive","closed"].includes(lower(status))) recipients.set(email, clean(name) || email); };
        participants.forEach(p => addRecipient(p.participantEmail || p.email || p.invitedEmail, p.participantName || p.name, p.status));
        subscriptions.forEach(p => addRecipient(p.email || p.subscriberEmail || p.participantEmail, p.subscriberName || p.participantName || p.name, p.status));
        for (const key of ["invitedEmails", "participantEmails", "attendeeEmails", "subscriberEmails"]) if (Array.isArray(state.meeting[key])) state.meeting[key].forEach(email => addRecipient(email));
        if (!recipients.size) return jsonError(ctx, request, "No valid participant email addresses were found; no report email was sent.", 409);
        const tally = outcome => votes.filter(v => lower(v.outcome || v.vote || v.choice) === lower(outcome)).length;
        const report = [
          "IMPROVEMENT OF RANGELAND IN PASTORAL AREAS (IRPA)", "STANDARD MEETING REPORT",
          "Report status: " + (["final","approved","reviewed"].includes(lower(state.meeting.proceedingsStatus)) ? "Compiled report — approval status recorded" : "Compiled report — draft / approval status not verified"),
          "Meeting title: " + (clean(state.meeting.title) || "Not recorded"),
          "Meeting reference: " + (clean(state.meeting.meetingReference || state.meeting.reference || state.meeting.id)),
          "Meeting category: " + state.category, "Date: " + (clean(state.meeting.date) || "Not recorded"),
          "Time: " + (clean(state.meeting.startTime) || "Not recorded") + (clean(state.meeting.endTime) ? " – " + clean(state.meeting.endTime) : ""),
          "Venue / platform: " + (clean(state.meeting.venue || state.meeting.meetingPlatform) || "Not recorded"),
          "Chairperson: " + (clean(state.meeting.chairperson) || "Not recorded"), "", "1. PURPOSE AND AGENDA",
          clean(state.meeting.agenda) || "No agenda recorded.", "", "2. MEETING STATUS, ATTENDANCE AND QUORUM",
          "Meeting status: " + (clean(state.meeting.status) || "Not recorded"),
          "Quorum verification: " + (state.meeting.quorumVerified === true ? "Verified" : state.meeting.quorumVerified === false ? "Not verified / not met" : "Not recorded"),
          "Attendance register must be verified against the authoritative attendance records.", "", "3. SUMMARY / COMPILED MINUTES",
          minutes || clean(state.meeting.minutes || state.meeting.summary) || "No minutes or summary were supplied.",
          "", "4. DECISIONS", decisions.length ? decisions.map((d,i)=>`${i+1}. ${clean(d.reference || d.title || d.decision || d.description) || "Recorded decision"}`).join("\n") : "No decisions recorded.",
          "", "5. RESOLUTIONS", resolutions.length ? resolutions.map((d,i)=>`${i+1}. ${clean(d.reference || d.title || d.resolution || d.description) || "Recorded resolution"}`).join("\n") : "No resolutions recorded.",
          "", "6. AGGREGATED VOTING STATISTICS (NO INDIVIDUAL VOTES DISCLOSED)", "For: " + tally("For"), "Against: " + tally("Against"), "Abstain: " + tally("Abstain"),
          "Voting status: " + (clean(state.meeting.votingStatus) || "Not recorded"), "Voting result: " + (clean(state.meeting.votingResult) || "Not recorded"),
          "", "7. ACTION ITEMS", clean(state.meeting.actionItems) || "No action items recorded.", "",
          "Compiled by: " + (actor.email || actor.uid), "Generated (UTC): " + nowIso(),
          "Compiled from registered IRPA-DBGS records. Missing information is not inferred."
        ].join("\n");
        const reportHash = await sha256(report);
        const dispatchId = await sha256(state.meeting.id + ":" + reportHash);
        const reportRecord = await addDoc(ctx, env, token, "meetingRecords", {
          meetingId: state.meeting.id, meetingReference: clean(state.meeting.meetingReference || state.meeting.reference || state.meeting.id),
          meetingTitle: clean(state.meeting.title), meetingCategory: state.category, meetingPolicyId: state.category,
          recordType: "MEETING_REPORT", recordLabel: "Compiled Meeting Report", title: "Standard Meeting Report — " + (clean(state.meeting.title) || state.meeting.id),
          content: report, contentHash: reportHash, integrityAlgorithm: "SHA-256", integrityStatus: "VERIFIED_AT_CAPTURE",
          version: 1, status: "Active", confidentialityClass: state.confidentiality, storageDestination: "FIRESTORE_MEETING_RECORDS",
          requiresHumanReview: true, retentionYears: retentionYears(state.category), retainUntil: addYears(new Date(), retentionYears(state.category)),
          capturedByUid: actor.uid, capturedByEmail: actor.email || null, capturedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), deletionStatus: "NOT_ELIGIBLE"
        });
        const reportId = clean(reportRecord.name).split("/").pop();
        let sentCount = 0; const results = [];
        for (const [to, name] of recipients) {
          try {
            const delivery = await ctx.sendMail(env, { to, subject: "IRPA Meeting Report | " + clean(state.meeting.meetingReference || state.meeting.id), text: report, html: "<pre style=\"white-space:pre-wrap;font-family:Arial,sans-serif\">" + report.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") + "</pre>" });
            sentCount++; results.push({ email: to, name, status: "Sent", messageId: delivery || null });
          } catch (error) { results.push({ email: to, name, status: "Failed", error: String(error?.message || error).slice(0, 160) }); }
        }
        await addDoc(ctx, env, token, "meetingReportDispatches", {
          meetingId: state.meeting.id, reportHash, reportContent: report, recipientCount: recipients.size, sentCount,
          failedCount: results.length - sentCount, status: sentCount === results.length ? "Sent" : "Partially Failed",
          recipients: results, initiatedByUid: actor.uid, initiatedByEmail: actor.email || null, createdAt: new Date(), updatedAt: new Date()
        }, dispatchId.slice(0, 40));
        await audit(ctx, env, token, actor, "MEETING_REPORT_COMPILED_AND_DISTRIBUTED", "meetingRecords", reportId, { reportHash, recipientCount: recipients.size, sentCount, failedCount: results.length - sentCount, aggregatedVoteCounts: { For: tally("For"), Against: tally("Against"), Abstain: tally("Abstain") } });
        return ctx.json({ ok: sentCount === results.length, reportRecordId: reportId, dispatchId: dispatchId.slice(0,40), reportHash, recipientCount: recipients.size, sentCount, failedCount: results.length - sentCount, status: sentCount === results.length ? "Sent" : "Partially Failed" }, 200, ctx.corsHeaders(request));
      }
      const recordId = clean(data.recordId);
      if (action === "capture" || action === "draft") {
        const state = await meetingContext(ctx, env, token, claims, clean(data.meetingId));
        if (action === "capture" && !state.controller) return jsonError(ctx, request, "Only an authorised meeting controller may capture an authoritative meeting record.", 403);
        if (action === "draft" && !state.canRead) return jsonError(ctx, request, "You are not authorised to save a draft for this meeting.", 403);
        const type = clean(data.recordType).toUpperCase(), content = clean(data.content), title = clean(data.title);
        if (!content || content.length > 150000 || !type) return jsonError(ctx, request, "A record type and content up to 150,000 characters are required.", 400);
        if (action === "capture" && type === "MINUTES_FINAL") {
          const approvalId = clean(data.approvalReference);
          if (!approvalId) return jsonError(ctx, request, "Final minutes require an approved authorization record ID. Save them as a draft until approved.", 409);
          const approval = plain(await getDoc(ctx, env, token, "authorizationRequests", approvalId));
          if (!approval || !["approved","authorized","completed"].includes(lower(approval.status)) || approval.meetingId !== state.meeting.id) return jsonError(ctx, request, "The referenced final-minutes approval is not valid for this meeting.", 409);
        }
        const retention = retentionYears(state.category), digest = await sha256(content), createdAt = new Date(), id = crypto.randomUUID();
        const row = {
          meetingId: state.meeting.id, meetingReference: clean(state.meeting.meetingReference || state.meeting.reference || state.meeting.title),
          meetingTitle: clean(state.meeting.title), meetingCategory: state.category, meetingPolicyId: state.category,
          recordType: type, recordLabel: recordLabel(type), title: title || recordLabel(type), content, contentHash: digest,
          integrityAlgorithm: "SHA-256", integrityStatus: "VERIFIED_AT_CAPTURE", version: 1, status: "Active",
          confidentialityClass: state.confidentiality, storageDestination: data.driveArchive?.provider === "Google Drive" ? "GOOGLE_DRIVE_AND_FIRESTORE_METADATA" : "FIRESTORE_MEETING_RECORDS",
          storagePath: null, documentPortalRequiredForBinary: true, approvalReference: clean(data.approvalReference) || null,
          legalHold: false, retentionYears: retention, retainUntil: addYears(createdAt, retention),
          retentionPolicyVersion: "IRPA-MEETING-RETENTION-1.0", capturedByUid: actor.uid, capturedByEmail: actor.email || null,
          capturedAt: createdAt, createdAt, updatedAt: createdAt, deletionStatus: "NOT_ELIGIBLE",
          draftOnly: action === "draft" || type.includes("DRAFT"), requiresHumanReview: action === "draft" || type.includes("DRAFT"),
          sourceTranscriptHash: data.sourceTranscript ? await sha256(data.sourceTranscript) : null,
          driveArchive: data.driveArchive || null, createdFrom: action === "draft" ? "IRPA_AI_MEETING_ASSISTANT" : "IRPA_MEETING_PORTAL"
        };
        const saved = await addDoc(ctx, env, token, "meetingRecords", row, id);
        await audit(ctx, env, token, actor, action === "draft" ? "MEETING_ASSISTANT_DRAFT_SAVED" : "MEETING_RECORD_CAPTURED", "meetingRecords", id, { recordType: type, contentHash: digest, retentionYears: retention, requiresHumanReview: row.requiresHumanReview });
        return ctx.json({ ok: true, recordId: id, recordType: type, contentHash: digest, integrityStatus: row.integrityStatus, retentionYears: retention, retainUntil: row.retainUntil.toISOString(), storageDestination: row.storageDestination, draftOnly: row.draftOnly, requiresHumanReview: row.requiresHumanReview, driveArchive: row.driveArchive }, 200, ctx.corsHeaders(request));
      }
      if (action === "proceedings") {
        const state = await meetingContext(ctx, env, token, claims, clean(data.meetingId));
        if (!state.canRead || isClosed(state.meeting.status)) return jsonError(ctx, request, "You are not authorised to save proceedings for this meeting, or the meeting is closed.", 403);
        const content = clean(data.content);
        if (!content || content.length > 150000) return jsonError(ctx, request, "Proceedings content is required and must not exceed 150,000 characters.", 400);
        const id = "live-transcript-" + (await sha256(state.meeting.id + ":" + actor.uid)).slice(0, 32);
        const previous = plain(await getDoc(ctx, env, token, "meetingRecords", id));
        const digest = await sha256(content), retention = retentionYears(state.category), createdAt = new Date();
        const row = {
          meetingId: state.meeting.id, meetingReference: clean(state.meeting.meetingReference || state.meeting.reference || state.meeting.title),
          meetingTitle: clean(state.meeting.title), meetingCategory: state.category, meetingPolicyId: state.category,
          recordType: "SUBSCRIBER_TRANSCRIPT_DRAFT", recordLabel: "Live Proceedings Transcript Draft",
          title: "Live Proceedings — " + clean(state.meeting.title || "IRPA Meeting"), content, contentHash: digest,
          integrityAlgorithm: "SHA-256", integrityStatus: "VERIFIED_AT_CAPTURE", version: Number(previous?.version || 0) + 1,
          status: "Active", confidentialityClass: state.confidentiality, storageDestination: "FIRESTORE_MEETING_RECORDS",
          legalHold: previous?.legalHold === true, retentionYears: retention, retainUntil: addYears(createdAt, retention),
          retentionPolicyVersion: "IRPA-MEETING-RETENTION-1.0", capturedByUid: actor.uid, capturedByEmail: actor.email || null,
          capturedAt: createdAt, updatedAt: createdAt, createdAt: previous?.createdAt || createdAt, deletionStatus: "NOT_ELIGIBLE", requiresHumanReview: true
        };
        if (previous) await putDoc(ctx, env, token, "meetingRecords", id, row, true);
        else await addDoc(ctx, env, token, "meetingRecords", row, id);
        await audit(ctx, env, token, actor, "LIVE_MEETING_PROCEEDINGS_AUTOSAVED", "meetingRecords", id, { contentHash: digest, version: row.version, characters: content.length, requiresHumanReview: true });
        return ctx.json({ ok: true, recordId: id, contentHash: digest, version: row.version, requiresHumanReview: true }, 200, ctx.corsHeaders(request));
      }
      if (action === "list") {
        const state = await meetingContext(ctx, env, token, claims, clean(data.meetingId));
        const rows = (await queryDocs(ctx, env, token, "meetingRecords", "meetingId", state.meeting.id)).filter(r => r.status === "Active").sort((a,b) => String(b.capturedAt || "").localeCompare(String(a.capturedAt || "")));
        await audit(ctx, env, token, actor, "MEETING_RECORD_REGISTER_VIEWED", "meetingRecords", null, { meetingId: state.meeting.id, recordCount: rows.length });
        return ctx.json({ ok: true, records: rows.map(r => ({ id:r.id,title:r.title,recordType:r.recordType,recordLabel:r.recordLabel,contentHash:r.contentHash,integrityStatus:r.integrityStatus,confidentialityClass:r.confidentialityClass,version:r.version,capturedAt:r.capturedAt||null,retainUntil:r.retainUntil||null,retentionYears:r.retentionYears,legalHold:r.legalHold===true,deletionStatus:r.deletionStatus||"NOT_ELIGIBLE",storageDestination:r.storageDestination })) }, 200, ctx.corsHeaders(request));
      }
      if (action === "retrieve") {
        if (!recordId) return jsonError(ctx, request, "Meeting record ID is required.", 400);
        const record = plain(await getDoc(ctx, env, token, "meetingRecords", recordId));
        if (!record) return jsonError(ctx, request, "Meeting record not found.", 404);
        const state = await meetingContext(ctx, env, token, claims, record.meetingId);
        if (!state.canRead || record.status !== "Active") return jsonError(ctx, request, "This record is not available to this identity or is no longer active.", 403);
        const digest = await sha256(record.content || "");
        if (digest !== record.contentHash) {
          await audit(ctx, env, token, actor, "MEETING_RECORD_INTEGRITY_FAILURE", "meetingRecords", recordId, { expectedHash: record.contentHash || null, actualHash: digest });
          return jsonError(ctx, request, "Record integrity verification failed. Access is blocked and an audit event was recorded.", 409);
        }
        await audit(ctx, env, token, actor, "MEETING_RECORD_RETRIEVED", "meetingRecords", recordId, { recordType: record.recordType, contentHash: digest });
        return ctx.json({ ok: true, record: { ...record, integrityStatus: "VERIFIED" } }, 200, ctx.corsHeaders(request));
      }
      if (action === "protection" || action === "dispose") {
        if (!recordId) return jsonError(ctx, request, "Meeting record ID is required.", 400);
        const record = plain(await getDoc(ctx, env, token, "meetingRecords", recordId));
        if (!record) return jsonError(ctx, request, "Meeting record not found.", 404);
        const state = await meetingContext(ctx, env, token, claims, record.meetingId);
        if (!state.controller || record.status !== "Active") return jsonError(ctx, request, "Only an authorised meeting controller may change protection for an active record.", 403);
        const operation = clean(data.operation).toUpperCase();
        if (action === "protection" && operation === "LEGAL_HOLD") {
          const held = data.enabled === true;
          await putDoc(ctx, env, token, "meetingRecords", recordId, { legalHold: held, legalHoldReason: held ? clean(data.reason) || "Legal or governance preservation hold" : null, legalHoldByUid: actor.uid, legalHoldAt: new Date(), updatedAt: new Date() }, true);
          await audit(ctx, env, token, actor, held ? "MEETING_RECORD_LEGAL_HOLD_APPLIED" : "MEETING_RECORD_LEGAL_HOLD_RELEASED", "meetingRecords", recordId, { reason: clean(data.reason) || null });
          return ctx.json({ ok: true, legalHold: held }, 200, ctx.corsHeaders(request));
        }
        if (action === "protection" && operation === "EXTEND_RETENTION") {
          const years = Number(data.retentionYears);
          if (!Number.isInteger(years) || years < 1 || years > 30) return jsonError(ctx, request, "Retention extension must be an integer from 1 to 30 years.", 400);
          const until = addYears(new Date(), years);
          await putDoc(ctx, env, token, "meetingRecords", recordId, { retentionYears: years, retainUntil: until, retentionPolicyVersion: "IRPA-MEETING-RETENTION-1.0-EXTENDED", retentionExtendedByUid: actor.uid, retentionExtendedAt: new Date(), updatedAt: new Date() }, true);
          await audit(ctx, env, token, actor, "MEETING_RECORD_RETENTION_EXTENDED", "meetingRecords", recordId, { retentionYears: years, retainUntil: until.toISOString() });
          return ctx.json({ ok: true, retentionYears: years, retainUntil: until.toISOString() }, 200, ctx.corsHeaders(request));
        }
        if (action === "dispose" && operation === "REQUEST_DELETE") {
          await putDoc(ctx, env, token, "meetingRecords", recordId, { deletionStatus: "PENDING_REVIEW", deletionRequestedByUid: actor.uid, deletionRequestedAt: new Date(), deletionReason: clean(data.reason) || "Retention/disposition review", updatedAt: new Date() }, true);
          await audit(ctx, env, token, actor, "MEETING_RECORD_DELETE_REQUESTED", "meetingRecords", recordId, { reason: clean(data.reason) || null });
          return ctx.json({ ok: true, deletionStatus: "PENDING_REVIEW", message: "Record is preserved. Final purge requires primary administrator review, expiry of retention and no legal hold." }, 200, ctx.corsHeaders(request));
        }
        if (action === "dispose" && operation === "PURGE") {
          if (!state.admin) return jsonError(ctx, request, "Only the primary administrator may execute a final purge.", 403);
          if (record.legalHold === true || record.deletionStatus !== "PENDING_REVIEW" || !record.retainUntil || new Date(record.retainUntil).getTime() > Date.now()) return jsonError(ctx, request, "Purge blocked: legal hold, retention period, or deletion review requirement is not satisfied.", 409);
          await firestore(ctx, env, token, `meetingRecords/${encodeURIComponent(recordId)}`, { method: "DELETE" });
          await audit(ctx, env, token, actor, "MEETING_RECORD_PURGED", "meetingRecords", recordId, { meetingId: record.meetingId, recordType: record.recordType, contentHash: record.contentHash });
          return ctx.json({ ok: true, deletionStatus: "PURGED" }, 200, ctx.corsHeaders(request));
        }
        return jsonError(ctx, request, "Unsupported record protection or disposition operation.", 400);
      }
      return jsonError(ctx, request, "Meeting service route is not implemented.", 501);
    } catch (error) {
      const status = Number(error?.status) || (/permission-denied|not authorised|not authorized/i.test(String(error?.message || "")) ? 403 : 503);
      console.error("MEETING_OPERATIONS_FAILURE", { action, actorUid: actor.uid || null, meetingId: clean(data.meetingId) || null, code: status, message: String(error?.message || error).slice(0, 180) });
      return jsonError(ctx, request, status === 503 ? "The meeting service could not complete this request. Check the Worker configuration and retry." : String(error.message || "Meeting operation failed."), status);
    }
  };
}
