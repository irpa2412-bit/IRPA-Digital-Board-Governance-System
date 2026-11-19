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
      ["/api/meeting-access/authorize", "authorize"],
      ["/api/meeting-invitations/dispatch", "dispatch"]
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
        const priorAccessId = clean(participant.meetingAccessId);
        const priorPass = priorAccessId ? await getDoc(ctx, env, adminToken, "meetingAccessTokens", priorAccessId) : null;
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
          const writes = [
            { update: { name: tokenDocName, fields: passFields }, currentDocument: { exists: false } },
            { update: { name: meetingDocName, fields: fieldsToFirestore(patch) }, updateMask: { fieldPaths: Object.keys(patch) }, currentDocument: { updateTime: meetingDoc.updateTime } }
          ];
          if (priorPass?.fields?.status?.stringValue === "Active") {
            writes.push({ update: { name: priorPass.name, fields: fieldsToFirestore({ status: "Revoked", revokedByUid: uid, revokedAt: new Date(), revocationReason: "Superseded by a newly issued meeting access pass" }) }, updateMask: { fieldPaths: ["status", "revokedByUid", "revokedAt", "revocationReason"] }, currentDocument: { updateTime: priorPass.updateTime } });
          }
          await commitWrites(ctx, env, adminToken, writes);
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

      if (action === "dispatch") {
        const accessId = clean(data.accessId);
        const accessToken = clean(data.accessToken);
        const password = clean(data.meetingPassword);
        if (!accessId || !accessToken || !password) return errorResponse(ctx, request, "A complete meeting access pass is required for dispatch.", 400);
        const passDoc = await getDoc(ctx, env, adminToken, "meetingAccessTokens", accessId);
        if (!passDoc) return errorResponse(ctx, request, "Meeting access pass was not found.", 404);
        const pass = docToPlain(passDoc);
        if (pass.status !== "Active" || !pass.expiresAt || new Date(pass.expiresAt).getTime() < Date.now()) return errorResponse(ctx, request, "The meeting access pass is no longer active.", 409);
        if (await sha256(accessToken) !== pass.tokenHash || await sha256(password) !== pass.passwordHash) return errorResponse(ctx, request, "The meeting access pass could not be verified.", 403);
        const [meetingDoc, participantDoc] = await Promise.all([
          getDoc(ctx, env, adminToken, "meetings", clean(pass.meetingId)),
          getDoc(ctx, env, adminToken, "participants", clean(pass.participantId))
        ]);
        if (!meetingDoc || !participantDoc) return errorResponse(ctx, request, "The linked meeting or participant record was not found.", 404);
        const meeting = docToPlain(meetingDoc), participant = docToPlain(participantDoc);
        if (participant.meetingId !== pass.meetingId) return errorResponse(ctx, request, "The participant is not linked to this meeting.", 409);
        const [admin, chair, secretary] = await Promise.all([
          isAdmin(ctx, env, adminToken, uid, claims),
          Promise.resolve(lower(meeting.chairpersonEmail) === email || clean(meeting.chairpersonUid) === uid),
          Promise.resolve(lower(meeting.secretaryEmail) === email || clean(meeting.secretaryUid) === uid)
        ]);
        if (!admin && !chair && !secretary && clean(meeting.initiatorUid) !== uid && clean(meeting.createdByUid) !== uid) return errorResponse(ctx, request, "Only an authorised meeting organiser may dispatch meeting access.", 403);
        if (!isActiveMeeting(meeting.status)) return errorResponse(ctx, request, "This meeting is closed and cannot issue invitations.", 409);
        const recipient = lower(participant.participantEmail || participant.email);
        if (!recipient || (pass.participantEmail && lower(pass.participantEmail) !== recipient)) return errorResponse(ctx, request, "The participant email does not match the issued access pass.", 409);
        const appUrl = clean(env.IRPA_APP_URL || "https://irpa-digital-board-governance.web.app").replace(/\/$/, "");
        const gateUrl = new URL(appUrl + "/");
        gateUrl.searchParams.set("meetingToken", accessToken);
        gateUrl.searchParams.set("meetingId", pass.meetingId);
        const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
        const meetingTitle = clean(meeting.title || meeting.reference || "IRPA Meeting");
        const participantName = clean(participant.participantName || participant.name || recipient);
        const reference = clean(meeting.reference || meeting.meetingReference || meetingTitle);
        const date = clean(meeting.date || meeting.meetingDate);
        const time = [clean(meeting.startTime), clean(meeting.endTime)].filter(Boolean).join(" – ");
        const venue = clean(meeting.venue || meeting.meetingVenue);
        const platform = clean(meeting.meetingPlatform || "As specified by the meeting organiser");
        const rawPlatformUrl = clean(meeting.platformAccessUrl || meeting.meetingUrl || meeting.onlineMeetingUrl || meeting.joinUrl);
        let platformUrl = "";
        try { const parsedPlatformUrl = new URL(rawPlatformUrl); if (["https:", "http:"].includes(parsedPlatformUrl.protocol)) platformUrl = parsedPlatformUrl.toString(); } catch {}
        const platformMeetingId = clean(meeting.platformMeetingId || meeting.externalMeetingId);
        const platformPasscode = clean(meeting.platformPasscode || meeting.externalMeetingPasscode);
        const agenda = clean(meeting.agenda || meeting.meetingAgenda);
        const subject = "IRPA Meeting Invitation — " + reference;
        const text = "Dear " + participantName + ",\n\nYou are invited to " + meetingTitle + ".\nMeeting reference: " + reference + "\nDate: " + (date || "See meeting notice") + "\nTime: " + (time || "See meeting notice") + "\nVenue: " + (venue || platform) + "\n\nOpen your independent IRPA Meeting Portal access link:\n" + gateUrl.toString() + "\n\nMeeting ID: " + pass.meetingId + "\nGate password: " + password + "\n\nThis link and password are for this meeting only. Do not forward them.\n\nIRPA Administration";
        const html = "<!doctype html><html><body style=\"font-family:Arial,sans-serif;line-height:1.6;color:#1f2937\"><h2>IRPA Meeting Invitation</h2><p>Dear " + escapeHtml(participantName) + ",</p><p>You are invited to <strong>" + escapeHtml(meetingTitle) + "</strong>.</p><p><strong>Meeting reference:</strong> " + escapeHtml(reference) + "<br><strong>Date:</strong> " + escapeHtml(date || "See meeting notice") + "<br><strong>Time:</strong> " + escapeHtml(time || "See meeting notice") + "<br><strong>Venue / platform:</strong> " + escapeHtml(venue || platform) + "</p><p><a href=\"" + escapeHtml(gateUrl.toString()) + "\">Open the IRPA Meeting Portal</a></p><p><strong>Meeting ID:</strong> " + escapeHtml(pass.meetingId) + "<br><strong>Gate password:</strong> " + escapeHtml(password) + "</p><p>This access link and password are valid for this meeting only. Do not forward them.</p><p>IRPA Administration</p></body></html>";
        if (typeof ctx.sendEmail !== "function") return errorResponse(ctx, request, "The meeting mail service is not available in this Worker environment.", 503);
        if (typeof ctx.enforceMailRateLimit === "function") await ctx.enforceMailRateLimit(env, uid);
        const messageId = await ctx.sendEmail(env, { to: recipient, subject, text, html });
        const dispatchedAt = new Date();
        const participantPatch = {
          invitationStatus: "Invitation Requested",
          meetingAccessDispatched: true,
          meetingAccessDispatchStatus: "Confirmed",
          meetingAccessId: accessId,
          meetingAccessTokenReference: accessId,
          meetingAccessExpiresAt: pass.expiresAt,
          meetingAccessDispatchedAt: dispatchedAt,
          meetingAccessDeliveryStatus: "Accepted by IRPA SMTP gateway",
          meetingAccessDispatchError: "",
          meetingAccessDispatchFailedAt: null,
          meetingAccessDispatchStage: "",
          meetingInvitationLinkStatus: "Released by IRPA Meeting Worker",
          meetingTokenStatus: "Released by IRPA Meeting Worker"
        };
        let participantStatusPersisted = true, auditPersisted = true;
        try {
          await firestoreRequest(ctx, env, adminToken, "participants/" + encodeURIComponent(pass.participantId) + "?updateMask.fieldPaths=" + Object.keys(participantPatch).map(encodeURIComponent).join("&updateMask.fieldPaths="), {
            method: "PATCH", body: JSON.stringify({ fields: fieldsToFirestore(participantPatch) })
          });
        } catch (persistError) {
          participantStatusPersisted = false;
          console.error("MEETING_INVITATION_SMTP_ACCEPTED_PARTICIPANT_STATUS_PENDING", { meetingId: pass.meetingId, participantId: pass.participantId, accessId, status: persistError.status || null });
        }
        try {
          await firestoreRequest(ctx, env, adminToken, "audit", {
            method: "POST", body: JSON.stringify({ fields: fieldsToFirestore({
              action: "MEETING_INVITATION_DISPATCHED", collection: "participants", recordId: pass.participantId,
              details: { meetingId: pass.meetingId, accessId, recipientDomain: recipient.split("@").pop(), provider: "IRPA SMTP Worker", messageId: String(messageId || ""), participantStatusPersisted },
              actorUid: uid, actorEmail: email || null, createdAt: dispatchedAt
            }) })
          });
        } catch (auditError) {
          auditPersisted = false;
          console.error("MEETING_INVITATION_SMTP_ACCEPTED_AUDIT_PENDING", { meetingId: pass.meetingId, participantId: pass.participantId, accessId, status: auditError.status || null });
        }
        return ctx.json({ ok: true, meetingAccessSent: true, deliveryStatus: "Accepted by IRPA SMTP gateway", participantStatusPersisted, auditPersisted, accessId, expiresAt: pass.expiresAt, messageId: String(messageId || "") }, 200, ctx.corsHeaders(request));
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
      const entryMode = lower(meeting.meetingEntryMode || "HOST_APPROVAL") === "DIRECT" ? "DIRECT" : "HOST_APPROVAL";
      const entryRequestId = await sha256("meeting-entry:" + pass.id + ":" + uid);
      let entryRequest = await getDoc(ctx, env, adminToken, "meetingEntryRequests", entryRequestId);
      if (entryRequest?.status === "DENIED") return errorResponse(ctx, request, "The meeting host declined this entry request. Contact the meeting initiator for assistance.", 403);
      if (entryMode === "DIRECT" || entryRequest?.status === "ADMITTED") {
        if (entryRequest && entryRequest.status !== "ADMITTED") {
          await firestoreRequest(ctx, env, adminToken, "meetingEntryRequests/" + encodeURIComponent(entryRequestId) + "?updateMask.fieldPaths=status&updateMask.fieldPaths=resolvedAt&updateMask.fieldPaths=resolvedBy", {
            method: "PATCH", body: JSON.stringify({ fields: fieldsToFirestore({ status: "ADMITTED", resolvedAt: new Date(), resolvedBy: "DIRECT_ENTRY_POLICY" }) })
          });
        }
        await firestoreRequest(ctx, env, adminToken, "audit", {
          method: "POST", body: JSON.stringify({ fields: fieldsToFirestore({
            action: "MEETING_ENTRY_AUTHORIZED", collection: "meetingAccessTokens", recordId: pass.id,
            details: { meetingId: pass.meetingId, participantId: pass.participantId, entryMode, gateway: "IRPA Meeting Entry Gateway" },
            actorUid: uid, actorEmail: email, createdAt: new Date()
          }) })
        });
        return ctx.json({
          ok: true, entryState: "AUTHORIZED", entryMode, meetingId: pass.meetingId, participantId: pass.participantId,
          meetingReference: pass.meetingReference || meeting.reference || meeting.title,
          meetingCategory: clean(meeting.meetingCategory || meeting.category || meeting.meetingType || "General Meeting"),
          meetingStatus: meeting.status || "Scheduled", participantName: clean(participant.participantName || participant.name || email)
        }, 200, ctx.corsHeaders(request));
      }
      if (!entryRequest) {
        const requestData = {
          meetingId: pass.meetingId, meetingReference: pass.meetingReference || meeting.reference || meeting.title || "",
          participantId: pass.participantId, participantName: clean(participant.participantName || participant.name) || email,
          participantUid: uid, participantEmail: email, accessId: pass.id, status: "PENDING",
          entryMode, requestedAt: new Date(), expiresAt: pass.expiresAt
        };
        try {
          await firestoreRequest(ctx, env, adminToken, "meetingEntryRequests?documentId=" + encodeURIComponent(entryRequestId), {
            method: "POST", body: JSON.stringify({ fields: fieldsToFirestore(requestData) })
          });
          entryRequest = { id: entryRequestId, ...requestData };
          await firestoreRequest(ctx, env, adminToken, "audit", {
            method: "POST", body: JSON.stringify({ fields: fieldsToFirestore({
              action: "MEETING_ENTRY_REQUESTED", collection: "meetingEntryRequests", recordId: entryRequestId,
              details: { meetingId: pass.meetingId, participantId: pass.participantId, entryMode },
              actorUid: uid, actorEmail: email, createdAt: new Date()
            }) })
          });
        } catch (createError) {
          if (createError.status !== 409) throw createError;
          entryRequest = await getDoc(ctx, env, adminToken, "meetingEntryRequests", entryRequestId);
        }
      }
      if (entryRequest?.status === "DENIED") return errorResponse(ctx, request, "The meeting host declined this entry request. Contact the meeting initiator for assistance.", 403);
      if (entryRequest?.status === "ADMITTED") return ctx.json({
        ok: true, entryState: "AUTHORIZED", entryMode, meetingId: pass.meetingId, participantId: pass.participantId,
        meetingReference: pass.meetingReference || meeting.reference || meeting.title,
        meetingCategory: clean(meeting.meetingCategory || meeting.category || meeting.meetingType || "General Meeting"),
        meetingStatus: meeting.status || "Scheduled", participantName: clean(participant.participantName || participant.name || email)
      }, 200, ctx.corsHeaders(request));
      return ctx.json({ ok: true, entryState: "WAITING_FOR_HOST", entryMode, entryRequestId, meetingId: pass.meetingId,
        participantId: pass.participantId, meetingReference: pass.meetingReference || meeting.reference || meeting.title,
        meetingCategory: clean(meeting.meetingCategory || meeting.category || meeting.meetingType || "General Meeting"),
        meetingStatus: meeting.status || "Scheduled", participantName: clean(participant.participantName || participant.name || email)
      }, 200, ctx.corsHeaders(request));
    } catch (error) {
      console.error("MEETING_PORTAL_API_FAILURE", { action, ...ids, code: error.status || null, message: String(error?.message || error).slice(0, 200) });
      return errorResponse(ctx, request, "The meeting service could not complete this request. Retry after checking the meeting register and service configuration.", 503);
    }
  };
}
