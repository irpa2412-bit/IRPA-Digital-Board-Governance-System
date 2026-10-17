const sha256 = async value => {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
};
const clean = value => String(value ?? "").trim();
const lower = value => clean(value).toLowerCase();
const isActiveMeeting = status => !["cancelled", "canceled", "completed", "archived", "closed"].includes(lower(status || "Scheduled"));
const randomToken = bytes => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
const gatePassword = () => randomToken(12).replace(/[-_]/g, "").slice(0, 12).toUpperCase();

function valueToFirestore(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(valueToFirestore) } };
  if (typeof value === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, valueToFirestore(v)])) } };
  return { stringValue: String(value) };
}
function fieldsToFirestore(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, valueToFirestore(item)]));
}
function docToPlain(document) {
  if (!document?.fields) return null;
  const convert = field => {
    if (!field) return null;
    if ("stringValue" in field) return field.stringValue;
    if ("booleanValue" in field) return field.booleanValue;
    if ("integerValue" in field) return Number(field.integerValue);
    if ("doubleValue" in field) return field.doubleValue;
    if ("timestampValue" in field) return field.timestampValue;
    if ("nullValue" in field) return null;
    if ("arrayValue" in field) return (field.arrayValue.values || []).map(convert);
    if ("mapValue" in field) return Object.fromEntries(Object.entries(field.mapValue.fields || {}).map(([k, v]) => [k, convert(v)]));
    return null;
  };
  return { id: String(document.name || "").split("/").pop(), ...Object.fromEntries(Object.entries(document.fields).map(([k, v]) => [k, convert(v)])) };
}
function errorResponse(ctx, request, message, status = 400) {
  return ctx.json({ ok: false, error: message }, status, ctx.corsHeaders(request));
}
async function firestoreRequest(ctx, env, token, path, init = {}) {
  const url = `https://firestore.googleapis.com/v1/projects/${ctx.getFirebaseProjectId(env)}/databases/(default)/documents/${path}`;
  const response = await fetch(url, {
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
  try { return await firestoreRequest(ctx, env, token, `${collection}/${encodeURIComponent(id)}`); }
  catch (error) { if (error.status === 404) return null; throw error; }
}
async function commitWrites(ctx, env, token, writes) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${ctx.getFirebaseProjectId(env)}/databases/(default)/documents:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Firestore commit failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return body;
}
async function isAdmin(ctx, env, adminToken, uid, claims) {
  if (claims.admin === true || lower(claims.email) === "irpa2412@gmail.com") return true;
  const profile = await getDoc(ctx, env, adminToken, "adminProfiles", uid);
  return profile?.fields?.active?.booleanValue === true;
}
function logStage(stage, status, ids, details = {}) {
  console.info("MEETING_ACCESS_INVITATION_STAGE", { stage, status, meetingId: ids.meetingId || null, participantId: ids.participantId || null, actorUid: ids.uid || null, ...details });
}

export function createMeetingPortalRouter(ctx) {
  return async function meetingPortalRouter(request, env, pathname) {
    const routes = new Map([
      ["/api/meeting-access/issue", "issue"],
      ["/api/meeting-access/revoke", "revoke"],
      ["/api/meeting-access/authorize", "authorize"]
    ]);
    const action = routes.get(pathname);
    if (!action || request.method !== "POST") return null;
    let claims;
    try {
      claims = await ctx.authenticateFirebaseRequest(request, env);
    } catch (error) {
      const authError = /authentication is required|invalid firebase|firebase token is expired|signing key not found/i.test(String(error?.message || ""));
      return errorResponse(ctx, request, authError ? "A valid IRPA sign-in is required." : "Your portal session could not be verified.", authError ? 401 : 503);
    }
    let data;
    try { data = await request.json(); }
    catch { return errorResponse(ctx, request, "A valid JSON request is required.", 400); }
    const uid = clean(claims.user_id);
    const email = lower(claims.email);
    const adminToken = await ctx.getFirestoreAdminAccessToken(env).catch(error => {
      console.error("MEETING_PORTAL_IDENTITY_CONFIGURATION_FAILED", { action, message: String(error?.message || error).slice(0, 160) });
      return null;
    });
    if (!adminToken) return errorResponse(ctx, request, "Meeting services are temporarily unavailable because the server identity is not configured.", 503);

    const ids = { meetingId: clean(data.meetingId), participantId: clean(data.participantId), uid };
    try {
      if (action === "issue") {
        let stage = "VALIDATE_INPUT";
        logStage(stage, "START", ids);
        if (!ids.meetingId || !ids.participantId) return errorResponse(ctx, request, "Meeting and participant are required.", 400);
        stage = "LOAD_MEETING_AND_PARTICIPANT";
        const [meetingDoc, participantDoc] = await Promise.all([
          getDoc(ctx, env, adminToken, "meetings", ids.meetingId),
          getDoc(ctx, env, adminToken, "participants", ids.participantId)
        ]);
        if (!meetingDoc || !participantDoc) {
          logStage(stage, "NOT_FOUND", ids, { meetingFound: Boolean(meetingDoc), participantFound: Boolean(participantDoc) });
          return errorResponse(ctx, request, "Meeting or participant was not found.", 404);
        }
        const meeting = docToPlain(meetingDoc), participant = docToPlain(participantDoc);
        logStage("RECORDS_LOADED", "SUCCESS", ids, { participantMeetingMatches: participant.meetingId === ids.meetingId });
        if (participant.meetingId !== ids.meetingId) return errorResponse(ctx, request, "Participant is not linked to the selected meeting.", 409);
        const [admin, chair, secretary] = await Promise.all([
          isAdmin(ctx, env, adminToken, uid, claims),
          Promise.resolve(lower(meeting.chairpersonEmail) === email),
          Promise.resolve(lower(meeting.secretaryEmail) === email)
        ]);
        const initiator = clean(meeting.initiatorUid) === uid;
        logStage("AUTHORIZATION_EVALUATED", "SUCCESS", ids, { isAdmin: admin, chair, secretary, initiator });
        if (!admin && !chair && !secretary && !initiator) return errorResponse(ctx, request, "Only the authorised meeting initiator, administrator, chairperson or secretary may issue meeting access.", 403);
        const raw = randomToken(32);
        const password = gatePassword();
        const accessId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const tokenHash = await sha256(raw), passwordHash = await sha256(password);
        const idsArray = Array.isArray(meeting.invitedParticipantIds) ? meeting.invitedParticipantIds.map(String) : [];
        const nextIds = [...new Set([...idsArray, ids.participantId])];
        const invitedEmails = new Set(Array.isArray(meeting.invitedEmails) ? meeting.invitedEmails.map(lower).filter(Boolean) : []);
        const participantEmails = new Set(Array.isArray(meeting.participantEmails) ? meeting.participantEmails.map(lower).filter(Boolean) : []);
        const participantEmail = lower(participant.participantEmail || participant.email);
        if (participantEmail) { invitedEmails.add(participantEmail); participantEmails.add(participantEmail); }
        const patch = {
          invitedParticipantIds: nextIds,
          invitedParticipantCount: nextIds.length,
          invitedEmails: [...invitedEmails],
          participantEmails: [...participantEmails],
          updatedAt: new Date()
        };
        const participantUid = clean(participant.participantUid || participant.uid || participant.userId);
        if (participantUid) {
          patch.invitedUids = [...new Set([...(Array.isArray(meeting.invitedUids) ? meeting.invitedUids : []), participantUid])];
          patch.participantUids = [...new Set([...(Array.isArray(meeting.participantUids) ? meeting.participantUids : []), participantUid])];
        }
        const tokenDocName = `projects/${ctx.getFirebaseProjectId(env)}/databases/(default)/documents/meetingAccessTokens/${accessId}`;
        const meetingDocName = meetingDoc.name;
        const passFields = fieldsToFirestore({
          meetingId: ids.meetingId,
          meetingReference: clean(meeting.reference || meeting.title),
          participantId: ids.participantId,
          participantEmail: participantEmail || null,
          participantUid: clean(participant.participantUid) || null,
          tokenHash, passwordHash, tokenVersion: "1", status: "Active",
          reusable: true, reusableUntilMeetingClosure: true, expiresAt,
          createdByUid: uid, createdAt: new Date(),
          gateway: "IRPA Meeting Entry Gateway", singlePurpose: "Live meeting entry"
        });
        try {
          logStage("CREATE_ACCESS_PASS_AND_UPDATE_INVITEE_TALLY", "START", ids);
          await commitWrites(ctx, env, adminToken, [
            { update: { name: tokenDocName, fields: passFields }, currentDocument: { exists: false } },
            { update: { name: meetingDocName, fields: fieldsToFirestore(patch) }, updateMask: { fieldPaths: Object.keys(patch) }, currentDocument: { updateTime: meetingDoc.updateTime } }
          ]);
        } catch (error) {
          console.error("MEETING_ACCESS_INVITATION_COMMIT_FAILED", { stage: "CREATE_ACCESS_PASS_AND_UPDATE_INVITEE_TALLY", ...ids, code: error.status || null, message: String(error?.message || error).slice(0, 180) });
          return errorResponse(ctx, request, "The meeting invitation could not be issued. Refresh the meeting register and retry.", 409);
        }
        logStage("SUCCESS", "SUCCESS", ids, { accessId });
        return ctx.json({
          ok: true, accessId, accessToken: raw, meetingId: ids.meetingId, meetingPassword: password,
          participantId: ids.participantId, participantName: clean(participant.participantName || participant.name || participant.email),
          meetingReference: clean(meeting.reference || meeting.title),
          meetingCategory: clean(meeting.meetingCategory || meeting.category || meeting.meetingType || "General Meeting"),
          reusable: true, reusePolicy: "Reusable for 30 days, or until revoked or the meeting is closed.", expiresAt: expiresAt.toISOString()
        }, 200, ctx.corsHeaders(request));
      }

      if (action === "revoke") {
        const accessId = clean(data.accessId);
        if (!accessId) return errorResponse(ctx, request, "Meeting access ID is required.", 400);
        const passDoc = await getDoc(ctx, env, adminToken, "meetingAccessTokens", accessId);
        if (!passDoc) return errorResponse(ctx, request, "Meeting access pass was not found.", 404);
        const pass = docToPlain(passDoc);
        const meetingDoc = await getDoc(ctx, env, adminToken, "meetings", clean(pass.meetingId));
        const meeting = meetingDoc ? docToPlain(meetingDoc) : {};
        const [admin, chair, secretary] = await Promise.all([
          isAdmin(ctx, env, adminToken, uid, claims),
          Promise.resolve(lower(meeting.chairpersonEmail) === email),
          Promise.resolve(lower(meeting.secretaryEmail) === email)
        ]);
        if (!admin && clean(pass.createdByUid) !== uid && !chair && !secretary) return errorResponse(ctx, request, "Only the issuer or an authorised meeting administrator may revoke this pass.", 403);
        if (pass.status !== "Revoked") {
          await firestoreRequest(ctx, env, adminToken, `meetingAccessTokens/${encodeURIComponent(accessId)}?updateMask.fieldPaths=status&updateMask.fieldPaths=revokedByUid&updateMask.fieldPaths=revokedAt`, {
            method: "PATCH", body: JSON.stringify({ fields: fieldsToFirestore({ status: "Revoked", revokedByUid: uid, revokedAt: new Date() }) })
          });
          const auditId = crypto.randomUUID();
          await firestoreRequest(ctx, env, adminToken, "audit", {
            method: "POST", body: JSON.stringify({ fields: fieldsToFirestore({
              action: "MEETING_ACCESS_INVITATION_REVOKED", collection: "meetingAccessTokens", recordId: accessId,
              details: { meetingId: pass.meetingId, participantId: pass.participantId }, actorUid: uid, actorEmail: email || null, createdAt: new Date()
            }) })
          });
        }
        return ctx.json({ ok: true, accessId, status: "Revoked" }, 200, ctx.corsHeaders(request));
      }

      const token = clean(data.accessToken), suppliedMeetingId = clean(data.meetingId), suppliedPassword = clean(data.meetingPassword);
      if (!token) return errorResponse(ctx, request, "Meeting access token is required.", 400);
      const tokenHash = await sha256(token);
      const queryResponse = await fetch(`https://firestore.googleapis.com/v1/projects/${ctx.getFirebaseProjectId(env)}/databases/(default)/documents:runQuery`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "meetingAccessTokens" }], where: { fieldFilter: { field: { fieldPath: "tokenHash" }, op: "EQUAL", value: { stringValue: tokenHash } } }, limit: 1 } })
      });
      const queryRows = await queryResponse.json().catch(() => []);
      if (!queryResponse.ok) throw new Error("Unable to verify the meeting access token.");
      const passDoc = (Array.isArray(queryRows) ? queryRows : []).find(row => row.document)?.document;
      if (!passDoc) return errorResponse(ctx, request, "This meeting access link is invalid.", 403);
      const pass = docToPlain(passDoc);
      if (suppliedMeetingId && suppliedMeetingId !== pass.meetingId) return errorResponse(ctx, request, "The supplied meeting ID does not match this gate pass.", 403);
      if (pass.status !== "Active" || !pass.expiresAt || new Date(pass.expiresAt).getTime() < Date.now()) return errorResponse(ctx, request, "This meeting access link has expired or been revoked.", 403);
      if (pass.passwordHash && await sha256(suppliedPassword) !== pass.passwordHash) return errorResponse(ctx, request, "The meeting ID and gate password do not match the issued gate pass.", 403);
      const [participantDoc, meetingDoc] = await Promise.all([
        getDoc(ctx, env, adminToken, "participants", clean(pass.participantId)),
        getDoc(ctx, env, adminToken, "meetings", clean(pass.meetingId))
      ]);
      if (!meetingDoc) return errorResponse(ctx, request, "The meeting record no longer exists.", 404);
      const participant = participantDoc ? docToPlain(participantDoc) : {};
      const meeting = docToPlain(meetingDoc);
      const boundEmail = lower(pass.participantEmail), boundUid = clean(pass.participantUid);
      if ((boundUid && boundUid !== uid) || (!boundUid && boundEmail && boundEmail !== email)) return errorResponse(ctx, request, "This meeting link is assigned to a different participant identity.", 403);
      if (!isActiveMeeting(meeting.status)) return errorResponse(ctx, request, "This meeting is closed and cannot be entered.", 409);
      const auditId = crypto.randomUUID();
      await firestoreRequest(ctx, env, adminToken, "audit", {
        method: "POST", body: JSON.stringify({ fields: fieldsToFirestore({
          action: "MEETING_ENTRY_AUTHORIZED", collection: "meetingAccessTokens", recordId: pass.id,
          details: { meetingId: pass.meetingId, participantId: pass.participantId, gateway: "IRPA Meeting Entry Gateway" },
          actorUid: uid, actorEmail: email, createdAt: new Date()
        }) })
      });
      return ctx.json({
        ok: true, meetingId: pass.meetingId, participantId: pass.participantId,
        meetingReference: pass.meetingReference || meeting.reference || meeting.title,
        meetingCategory: clean(meeting.meetingCategory || meeting.category || meeting.meetingType || "General Meeting"),
        meetingStatus: meeting.status || "Scheduled", participantName: clean(participant.participantName || participant.name || email)
      }, 200, ctx.corsHeaders(request));
    } catch (error) {
      console.error("MEETING_PORTAL_API_FAILURE", { action, ...ids, code: error.status || null, message: String(error?.message || error).slice(0, 200) });
      return errorResponse(ctx, request, "The meeting service could not complete this request. Retry after checking the meeting register and service configuration.", 503);
    }
  };
}
