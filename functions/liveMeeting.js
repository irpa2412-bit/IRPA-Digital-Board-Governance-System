const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { AccessToken, EgressClient, EncodedFileOutput, EncodedFileType } = require("livekit-server-sdk");
const { defineSecret } = require("firebase-functions/params");
const crypto = require("crypto");

const db = getFirestore();

// Keep media credentials in Google Secret Manager; never bake them into source or browser bundles.
const LIVEKIT_URL = defineSecret("LIVEKIT_URL");
const LIVEKIT_API_KEY = defineSecret("LIVEKIT_API_KEY");
const LIVEKIT_API_SECRET = defineSecret("LIVEKIT_API_SECRET");

function text(value) {
  return String(value ?? "").trim();
}

function activeRecord(record = {}) {
  const status = text(record.status || record.employmentStatus || record.registrationStatus).toLowerCase();
  return !status || ["active", "activated", "current"].includes(status);
}

function registeredRoles(record = {}) {
  return [
    record.role,
    record.boardPosition,
    record.unit,
    record.unitName,
    ...(Array.isArray(record.roles) ? record.roles : []),
    ...(Array.isArray(record.assignedRoles) ? record.assignedRoles : []),
    ...(Array.isArray(record.selectedRoles) ? record.selectedRoles : []),
    ...(Array.isArray(record.roleAssignments) ? record.roleAssignments : [])
  ]
    .flatMap(value => text(value).split(","))
    .map(value => value.trim())
    .filter(Boolean);
}

function selectedAuthorityMatches(record, authority) {
  if (!authority) return true;
  return registeredRoles(record).includes(authority);
}

function participantListed(meeting = {}, uid) {
  const arrays = [
    meeting.participantUids,
    meeting.attendeeUids,
    meeting.memberUids,
    meeting.invitedUids,
    meeting.subscriberUids
  ];
  if (arrays.some(list => Array.isArray(list) && list.includes(uid))) return true;

  const participantCollections = [meeting.participants, meeting.attendees];
  for (const list of participantCollections) {
    if (!Array.isArray(list)) continue;
    if (list.some(item => text(item?.uid || item?.userId || item?.memberUid) === uid)) return true;
  }
  return false;
}

function meetingOpenForMedia(meeting = {}) {
  const status = text(meeting.status || "Scheduled").toLowerCase();
  return !["closed", "completed", "cancelled", "canceled", "archived"].includes(status);
}

function opaqueRoomName(meetingId, sessionId) {
  const digest = crypto.createHash("sha256").update(`${meetingId}:${sessionId}`).digest("hex").slice(0, 32);
  return `irpa-meeting-${digest}`;
}

function liveKitConfigured() {
  return Boolean(text(LIVEKIT_URL.value()) && text(LIVEKIT_API_KEY.value()) && text(LIVEKIT_API_SECRET.value()));
}

function moderatorForMeeting(meeting = {}, uid, email, selectedAuthority) {
  const actorEmail = text(email).toLowerCase();
  const authority = text(selectedAuthority).toLowerCase();
  if (meeting.chairpersonUid && text(meeting.chairpersonUid) === uid) return true;
  if (meeting.secretaryUid && text(meeting.secretaryUid) === uid) return true;
  if (text(meeting.chairpersonEmail).toLowerCase() === actorEmail && actorEmail) return true;
  if (text(meeting.secretaryEmail).toLowerCase() === actorEmail && actorEmail) return true;
  return ["board chairperson","board secretary","chairperson","meeting chair","meeting secretary","secretary"]
    .includes(authority);
}

/**
 * Server-side meeting media authorization boundary.
 *
 * The browser never supplies a trusted role, room name, or LiveKit secret.
 * The callable resolves the meeting and participant from IRPA records, then
 * issues a short-lived room-scoped LiveKit token.
 *
 * This function is intentionally additive: it does not change existing meeting
 * records, Firebase Authentication claims, administrator access, voting, or
 * invitations.
 */
exports.issueLiveMeetingToken = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  enforceAppCheck: false,
  secrets: [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET]
}, async request => {
  const uid = request.auth?.uid;
  const email = text(request.auth?.token?.email).toLowerCase();
  if (!uid) throw new HttpsError("unauthenticated", "IRPA authentication is required.");

  const meetingId = text(request.data?.meetingId);
  const selectedAuthority = text(request.data?.selectedAuthority);
  if (!meetingId) throw new HttpsError("invalid-argument", "Meeting ID is required.");
  if (!liveKitConfigured()) {
    throw new HttpsError("failed-precondition", "Live meeting infrastructure is not configured on the server.");
  }

  const meetingSnap = await db.collection("meetings").doc(meetingId).get();
  if (!meetingSnap.exists) throw new HttpsError("not-found", "The requested meeting was not found.");
  const meeting = { id: meetingSnap.id, ...meetingSnap.data() };

  if (!meetingOpenForMedia(meeting)) {
    throw new HttpsError("failed-precondition", "This meeting is closed and cannot accept a live media session.");
  }

  const [memberSnap, employeeSnap] = await Promise.all([
    db.collection("members").doc(uid).get(),
    db.collection("employees").doc(uid).get()
  ]);
  const records = [];
  if (memberSnap.exists) records.push(memberSnap.data() || {});
  if (employeeSnap.exists) records.push(employeeSnap.data() || {});

  // When a participant arrives through the Invitation Portal gate, validate
  // the server-side participant record again before issuing a media token.
  // The browser-provided ID is only a lookup key; meeting and identity binding
  // are re-verified here and never trusted from client state alone.
  const participantId = text(request.data?.participantId);
  let invitedParticipant = null;
  if (participantId) {
    const participantSnap = await db.collection("participants").doc(participantId).get();
    if (!participantSnap.exists) {
      throw new HttpsError("permission-denied", "The invitation participant record could not be verified.");
    }
    const candidate = { id: participantSnap.id, ...participantSnap.data() };
    if (text(candidate.meetingId) !== meetingId) {
      throw new HttpsError("permission-denied", "The invited participant is not linked to this meeting.");
    }
    const boundUid = text(candidate.participantUid || candidate.uid || candidate.userId);
    const boundEmail = text(candidate.participantEmail || candidate.email).toLowerCase();
    if ((boundUid && boundUid !== uid) || (boundEmail && boundEmail !== email) || (!boundUid && !boundEmail)) {
      throw new HttpsError("permission-denied", "The invitation participant identity does not match the signed-in account.");
    }
    const participantStatus = text(candidate.status).toLowerCase();
    if (["cancelled", "canceled", "revoked", "removed", "inactive", "closed"].includes(participantStatus)) {
      throw new HttpsError("permission-denied", "This meeting participant invitation is no longer active.");
    }
    invitedParticipant = candidate;
  }

  const isAdmin = request.auth?.token?.admin === true || email === "irpa2412@gmail.com";
  const activeIdentity = isAdmin || records.some(activeRecord) || Boolean(invitedParticipant);
  if (!activeIdentity) throw new HttpsError("permission-denied", "An active IRPA member, employee, or verified meeting invitee identity is required.");

  const listed = Boolean(invitedParticipant) || participantListed(meeting, uid);
  if (!isAdmin && !listed) {
    throw new HttpsError("permission-denied", "This account is not registered as a participant in the selected meeting.");
  }

  const invitedRoles = invitedParticipant
    ? [
        invitedParticipant.role,
        invitedParticipant.participantRole,
        invitedParticipant.authority,
        ...(Array.isArray(invitedParticipant.roles) ? invitedParticipant.roles : [])
      ].map(value => text(value)).filter(Boolean)
    : [];
  const authorityMatches = records.some(record => selectedAuthorityMatches(record, selectedAuthority)) || invitedRoles.includes(selectedAuthority);
  if (!isAdmin && selectedAuthority && !authorityMatches) {
    throw new HttpsError("permission-denied", "The selected access authority is not registered to this account.");
  }

  const sessionRef = db.collection("liveMeetingSessions").doc();
  // The room identity is meeting-scoped, not session-scoped: every authorized
  // participant in this meeting must join the same SFU room. Session IDs remain
  // unique audit records and must not partition host and invitee into separate rooms.
  const roomName = opaqueRoomName(meetingId, "shared-live-room");
  const participantIdentity = `uid-${uid}`;
  const moderator = isAdmin || moderatorForMeeting(meeting, uid, email, selectedAuthority);
  const token = new AccessToken(LIVEKIT_API_KEY.value(), LIVEKIT_API_SECRET.value(), {
    identity: participantIdentity,
    name: text(meeting.displayName || meeting.title || "IRPA participant"),
    ttl: "10m"
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: moderator
  });

  const participantLabel = selectedAuthority || "Meeting Participant";
  await sessionRef.set({
    meetingId,
    meetingReference: text(meeting.reference || meeting.title) || null,
    roomName,
    participantUid: uid,
    participantIdentity,
    participantAuthority: participantLabel,
    moderator,
    recordingPolicy: meeting.recordingAllowed === true ? "Allowed by meeting record" : "Not enabled",
    createdByUid: uid,
    createdAt: FieldValue.serverTimestamp(),
    status: "Token Issued",
    tokenTtl: "10m",
    mediaEngine: "LiveKit",
    mediaEndpoint: text(LIVEKIT_URL.value()),
    governanceAuthorityRemainsIRPA: true
  });

  await db.collection("audit").add({
    action: "LIVE_MEETING_TOKEN_ISSUED",
    collection: "liveMeetingSessions",
    recordId: sessionRef.id,
    details: {
      meetingId,
      roomName,
      participantUid: uid,
      participantAuthority: participantLabel,
      moderator,
      recordingPolicy: meeting.recordingAllowed === true ? "Allowed by meeting record" : "Not enabled",
      tokenTtl: "10m",
      mediaEngine: "LiveKit"
    },
    actorUid: uid,
    actorEmail: email || null,
    createdAt: FieldValue.serverTimestamp()
  });

  return {
    ok: true,
    sessionId: sessionRef.id,
    serverUrl: text(LIVEKIT_URL.value()),
    participantToken: await token.toJwt(),
    moderator,
    recordingAllowed: meeting.recordingAllowed === true,
    expiresInSeconds: 600
  };
});


function egressClient() {
  if (!liveKitConfigured()) throw new HttpsError("failed-precondition", "Live meeting infrastructure is not configured on the server.");
  const host = text(LIVEKIT_URL.value()).replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
  return new EgressClient(host, LIVEKIT_API_KEY.value(), LIVEKIT_API_SECRET.value());
}
async function resolveRecordingControl(request, meetingId, options = {}) {
  const uid = request.auth?.uid;
  const email = text(request.auth?.token?.email).toLowerCase();
  if (!uid) throw new HttpsError("unauthenticated", "IRPA authentication is required.");
  if (!meetingId) throw new HttpsError("invalid-argument", "Meeting ID is required.");
  const snap = await db.collection("meetings").doc(meetingId).get();
  if (!snap.exists) throw new HttpsError("not-found", "The requested meeting was not found.");
  const meeting = { id: snap.id, ...snap.data() };
  const isAdmin = request.auth?.token?.admin === true || email === "irpa2412@gmail.com";
  if (!options.allowClosed && !meetingOpenForMedia(meeting)) throw new HttpsError("failed-precondition", "This meeting is closed and recording cannot be controlled.");
  if (options.requireRecordingAllowed !== false && meeting.recordingAllowed !== true) throw new HttpsError("permission-denied", "Recording is not enabled in the authoritative meeting record.");
  const results = await Promise.all([
    db.collection("members").doc(uid).get(),
    db.collection("employees").doc(uid).get()
  ]);
  const profiles = results.filter(s => s.exists).map(s => s.data() || {});
  const activeIdentity = profiles.some(activeRecord);
  const participantId = text(request.data?.participantId);
  let invitedParticipant = null;
  if (participantId) {
    const participantSnap = await db.collection("participants").doc(participantId).get();
    if (!participantSnap.exists) throw new HttpsError("permission-denied", "The meeting participant record could not be verified.");
    const candidate = { id: participantSnap.id, ...participantSnap.data() };
    if (text(candidate.meetingId) !== meetingId) throw new HttpsError("permission-denied", "The participant record is not linked to this meeting.");
    const boundUid = text(candidate.participantUid || candidate.uid || candidate.userId);
    const boundEmail = text(candidate.participantEmail || candidate.email).toLowerCase();
    if ((boundUid && boundUid !== uid) || (boundEmail && boundEmail !== email) || (!boundUid && !boundEmail)) {
      throw new HttpsError("permission-denied", "Participant identity does not match this account.");
    }
    if (["cancelled", "canceled", "revoked", "removed", "inactive", "closed"].includes(text(candidate.status).toLowerCase())) {
      throw new HttpsError("permission-denied", "This meeting invitation is no longer active.");
    }
    invitedParticipant = candidate;
  }
  const subQueries = await Promise.all([
    db.collection("meetingSubscriptions").where("meetingId", "==", meetingId).where("uid", "==", uid).limit(1).get().catch(() => ({ empty: true })),
    db.collection("meetingSubscriptions").where("meetingId", "==", meetingId).where("subscriberUid", "==", uid).limit(1).get().catch(() => ({ empty: true }))
  ]);
  const invited = Boolean(invitedParticipant) || participantListed(meeting, uid) || subQueries.some(s => !s.empty);
  if (!isAdmin && (!activeIdentity && !invited)) throw new HttpsError("permission-denied", "An active IRPA identity or verified invitee is required.");
  if (!isAdmin && !invited) throw new HttpsError("permission-denied", "This account is not registered or subscribed to the selected meeting.");
  const authority = text(request.data?.selectedAuthority);
  const profileRoles = profiles.flatMap(registeredRoles);
  const invitedRoles = invitedParticipant ? [
    invitedParticipant.role, invitedParticipant.participantRole, invitedParticipant.authority,
    ...(Array.isArray(invitedParticipant.roles) ? invitedParticipant.roles : [])
  ].map(text).filter(Boolean) : [];
  const authorityMatches = !authority || profileRoles.includes(authority) || invitedRoles.includes(authority);
  if (!authorityMatches) throw new HttpsError("permission-denied", "The selected access authority is not registered to this account.");
  const trustedModeratorRole = profileRoles.concat(invitedRoles).find(role =>
    ["board chairperson", "board secretary", "chairperson", "meeting chair", "meeting secretary", "secretary"].includes(text(role).toLowerCase())
  ) || "";
  const controller = isAdmin ||
    (meeting.chairpersonUid && text(meeting.chairpersonUid) === uid) ||
    (meeting.secretaryUid && text(meeting.secretaryUid) === uid) ||
    (text(meeting.chairpersonEmail).toLowerCase() === email && Boolean(email)) ||
    (text(meeting.secretaryEmail).toLowerCase() === email && Boolean(email)) ||
    text(meeting.createdByUid) === uid ||
    text(meeting.initiatorUid) === uid ||
    moderatorForMeeting(meeting, uid, email, trustedModeratorRole);
  return { uid, email, meeting, isAdmin, invited, controller };
}
function recordingRoomName(meetingId) {
  return opaqueRoomName(meetingId, "shared-live-room");
}
function safeRecordingId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}
exports.startMeetingRecording = onCall({
  region: "us-central1", timeoutSeconds: 60,
  secrets: [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET]
}, async request => {
  const ctx = await resolveRecordingControl(request, text(request.data?.meetingId));
  if (!ctx.controller) throw new HttpsError("permission-denied", "Only the meeting administrator, initiator, chairperson or secretary may start recording.");
  const roomName = recordingRoomName(ctx.meeting.id);
  const activeRecordings = await db.collection("meetingMediaRecordings").where("meetingId", "==", ctx.meeting.id).get();
  if (activeRecordings.docs.some(doc => ["STARTING", "RECORDING", "STOPPING"].includes(text(doc.data()?.recordingStatus)))) {
    throw new HttpsError("already-exists", "A recording is already active or stopping for this meeting.");
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filepath = "irpa-governance-recordings/" + safeRecordingId(ctx.meeting.id) + "/" + stamp + ".mp4";
  let egress;
  try {
    egress = await egressClient().startRoomCompositeEgress(
      roomName,
      { file: new EncodedFileOutput({ filepath, fileType: EncodedFileType.MP4 }) },
      { layout: "grid", audioOnly: false }
    );
  } catch (error) {
    await db.collection("audit").add({
      action: "LIVE_MEETING_RECORDING_START_FAILED", collection: "meetingMediaRecordings", recordId: null,
      details: { meetingId: ctx.meeting.id, reason: text(error?.message).slice(0, 500), storageDestination: "LIVEKIT_EGRESS_CONFIGURED_STORAGE" },
      actorUid: ctx.uid, actorEmail: ctx.email || null, createdAt: FieldValue.serverTimestamp()
    });
    throw new HttpsError("failed-precondition", "Recording could not start. Verify that LiveKit Egress is running and its recording storage is configured; no recording has been confirmed.");
  }
  const egressId = text(egress.egressId);
  if (!egressId) throw new HttpsError("internal", "LiveKit did not return a recording identifier.");
  const row = {
    meetingId: ctx.meeting.id,
    meetingReference: text(ctx.meeting.meetingReference || ctx.meeting.reference || ctx.meeting.title),
    meetingTitle: text(ctx.meeting.title), meetingCategory: categoryOf(ctx.meeting), roomName,
    egressId, outputPath: filepath, recordingStatus: "RECORDING",
    egressStatus: String(egress.status ?? "UNKNOWN"),
    recordingProvider: "LIVEKIT_EGRESS", storageDestination: "LIVEKIT_EGRESS_CONFIGURED_STORAGE",
    startedByUid: ctx.uid, startedByEmail: ctx.email || null,
    startedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  };
  await db.collection("meetingMediaRecordings").doc(egressId).set(row);
  await db.collection("meetings").doc(ctx.meeting.id).update({
    recordingStatus: "RECORDING", recordingEgressId: egressId,
    recordingStartedAt: FieldValue.serverTimestamp(), recordingStartedByUid: ctx.uid,
    recordingStorage: row.storageDestination
  });
  await db.collection("audit").add({
    action: "LIVE_MEETING_RECORDING_STARTED", collection: "meetingMediaRecordings", recordId: egressId,
    details: { meetingId: ctx.meeting.id, meetingCategory: row.meetingCategory, egressId, outputPath: filepath, storageDestination: row.storageDestination },
    actorUid: ctx.uid, actorEmail: ctx.email || null, createdAt: FieldValue.serverTimestamp()
  });
  return { ok: true, recordingId: egressId, egressId, recordingStatus: "RECORDING", outputPath: filepath, storageDestination: row.storageDestination };
});
exports.stopMeetingRecording = onCall({
  region: "us-central1", timeoutSeconds: 60,
  secrets: [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET]
}, async request => {
  const meetingId = text(request.data?.meetingId);
  const recordingId = text(request.data?.recordingId || request.data?.egressId);
  if (!recordingId) throw new HttpsError("invalid-argument", "Recording ID is required.");
  const ctx = await resolveRecordingControl(request, meetingId);
  if (!ctx.controller) throw new HttpsError("permission-denied", "Only the meeting administrator, initiator, chairperson or secretary may stop recording.");
  const ref = db.collection("meetingMediaRecordings").doc(recordingId);
  const snap = await ref.get();
  if (!snap.exists || text(snap.data()?.meetingId) !== meetingId) throw new HttpsError("not-found", "Recording does not belong to this meeting.");
  if (!["RECORDING", "STARTING", "STOPPING"].includes(text(snap.data()?.recordingStatus))) {
    throw new HttpsError("failed-precondition", "This recording is not active.");
  }
  let result;
  try {
    result = await egressClient().stopEgress(recordingId);
  } catch (error) {
    throw new HttpsError("failed-precondition", "LiveKit did not confirm that recording stopped. Check the recording service before retrying.");
  }
  const egressStatus = String(result.status ?? "UNKNOWN");
  const numericStatus = Number(result.status);
  const recordingStatus = numericStatus === 3 ? "COMPLETED" : [4, 5, 6].includes(numericStatus) ? "FAILED" : "STOPPING";
  const files = Array.isArray(result.fileResults) ? result.fileResults.map(file => ({
    filename: text(file.filename), location: text(file.location), size: Number(file.size || 0)
  })) : [];
  await ref.update({
    recordingStatus, egressStatus,
    fileResults: files, stoppedByUid: ctx.uid, stoppedByEmail: ctx.email || null,
    stopRequestedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  });
  await db.collection("meetings").doc(meetingId).update({
    recordingStatus, recordingStoppedAt: FieldValue.serverTimestamp(),
    recordingStoppedByUid: ctx.uid
  });
  await db.collection("audit").add({
    action: "LIVE_MEETING_RECORDING_STOP_REQUESTED", collection: "meetingMediaRecordings", recordId: recordingId,
    details: { meetingId, egressStatus, recordingStatus, fileCount: files.length },
    actorUid: ctx.uid, actorEmail: ctx.email || null, createdAt: FieldValue.serverTimestamp()
  });
  return { ok: true, recordingId, recordingStatus, egressStatus, files };
});
exports.getMeetingRecordingStatus = onCall({
  region: "us-central1", timeoutSeconds: 30,
  secrets: [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET]
}, async request => {
  const ctx = await resolveRecordingControl(request, text(request.data?.meetingId), { requireRecordingAllowed: false, allowClosed: true });
  if (!ctx.invited && !ctx.isAdmin && !ctx.controller) throw new HttpsError("permission-denied", "An authorised meeting participant is required to view recording status.");
  const snap = await db.collection("meetingMediaRecordings").where("meetingId", "==", ctx.meeting.id).get();
  const rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) =>
    (b.startedAt?.toMillis?.() || 0) - (a.startedAt?.toMillis?.() || 0)
  );
  const row = rows[0];
  if (!row) return { ok: true, recordingAllowed: ctx.meeting.recordingAllowed === true, recordingStatus: "NOT_STARTED", recording: null };
  return {
    ok: true, recordingAllowed: ctx.meeting.recordingAllowed === true,
    recordingStatus: row.recordingStatus || "UNKNOWN",
    recording: {
      id: row.id, egressId: row.egressId, outputPath: row.outputPath || null,
      status: row.recordingStatus || "UNKNOWN", egressStatus: row.egressStatus || null,
      startedAt: row.startedAt?.toDate?.().toISOString?.() || null,
      stoppedAt: row.stopRequestedAt?.toDate?.().toISOString?.() || null,
      files: Array.isArray(row.fileResults) ? row.fileResults.map(file => ({ filename: file.filename || "", location: file.location || "", size: file.size || 0 })) : []
    }
  };
});
