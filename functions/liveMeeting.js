const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { AccessToken, EgressClient, RoomServiceClient, EncodedFileOutput, EncodedFileType, GCPUpload } = require("livekit-server-sdk");
const { Storage } = require("@google-cloud/storage");
const { defineSecret } = require("firebase-functions/params");
const crypto = require("crypto");

const db = getFirestore();

// Keep media credentials in Google Secret Manager; never bake them into source or browser bundles.
const LIVEKIT_URL = defineSecret("LIVEKIT_URL");
const LIVEKIT_API_KEY = defineSecret("LIVEKIT_API_KEY");
const LIVEKIT_API_SECRET = defineSecret("LIVEKIT_API_SECRET");
const LIVEKIT_RECORDING_STORAGE_GCP_CREDENTIALS = defineSecret("LIVEKIT_RECORDING_STORAGE_GCP_CREDENTIALS");
const LIVEKIT_RECORDING_STORAGE_GCP_BUCKET = defineSecret("LIVEKIT_RECORDING_STORAGE_GCP_BUCKET");

function text(value) {
  return String(value ?? "").trim();
}

function activeRecord(record = {}) {
  const status = text(record.status || record.employmentStatus || record.registrationStatus).toLowerCase();
  return !status || ["active", "activated", "current"].includes(status);
}

function designatedMeetingController(meeting = {}, uid, email) {
  if (!uid) return false;
  const assignedUids = [meeting.initiatorUid, meeting.createdByUid, meeting.chairpersonUid, meeting.secretaryUid].map(text);
  const assignedEmails = [meeting.initiatorEmail, meeting.createdByEmail, meeting.chairpersonEmail, meeting.secretaryEmail].map(value => text(value).toLowerCase()).filter(Boolean);
  return assignedUids.includes(uid) || Boolean(email && assignedEmails.includes(email));
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
  const designatedController = designatedMeetingController(meeting, uid, email);
  if (!isAdmin && !listed && !designatedController) {
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
  const moderator = isAdmin || designatedController || moderatorForMeeting(meeting, uid, email, selectedAuthority);
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


function liveKitHttpsHost() {
  return text(LIVEKIT_URL.value()).replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
}
function egressClient() {
  if (!liveKitConfigured()) throw new HttpsError("failed-precondition", "Live meeting infrastructure is not configured on the server.");
  return new EgressClient(liveKitHttpsHost(), LIVEKIT_API_KEY.value(), LIVEKIT_API_SECRET.value());
}
function recordingStorageConfig() {
  const credentialsJson = text(LIVEKIT_RECORDING_STORAGE_GCP_CREDENTIALS.value());
  const bucket = text(LIVEKIT_RECORDING_STORAGE_GCP_BUCKET.value());
  if (!credentialsJson || !bucket) {
    throw new HttpsError("failed-precondition", "Recording storage is not configured. Proceedings cannot start until protected recording storage is available.");
  }
  let credentials;
  try { credentials = JSON.parse(credentialsJson); }
  catch { throw new HttpsError("failed-precondition", "The protected recording storage credential is invalid JSON."); }
  if (credentials.type !== "service_account" || !text(credentials.client_email) || !text(credentials.private_key) || !text(credentials.project_id)) {
    throw new HttpsError("failed-precondition", "The protected recording storage credential is incomplete.");
  }
  const runtimeProject = text(process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT);
  if (runtimeProject && credentials.project_id !== runtimeProject) {
    throw new HttpsError("failed-precondition", "Recording storage credential belongs to a different Firebase project.");
  }
  return { credentialsJson, credentials, bucket };
}
function recordingFileOutput(filepath) {
  const storage = recordingStorageConfig();
  return {
    storageBucket: storage.bucket,
    file: new EncodedFileOutput({
      filepath,
      fileType: EncodedFileType.MP4,
      output: {
        case: "gcp",
        value: new GCPUpload({ bucket: storage.bucket, credentials: storage.credentialsJson })
      }
    })
  };
}
async function ensureRecordingRoom(roomName) {
  const service = new RoomServiceClient(liveKitHttpsHost(), LIVEKIT_API_KEY.value(), LIVEKIT_API_SECRET.value());
  let rooms = await service.listRooms([roomName]);
  if (!rooms.some(room => text(room.name) === roomName)) {
    try {
      await service.createRoom({ name: roomName, emptyTimeout: 3600, maxParticipants: 250 });
    } catch (error) {
      // Another authorized start may have created the room between list and create.
      rooms = await service.listRooms([roomName]);
      if (!rooms.some(room => text(room.name) === roomName)) throw error;
    }
  }
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
  const designatedController = designatedMeetingController(meeting, uid, email);
  if (!isAdmin && (!activeIdentity && !invited)) throw new HttpsError("permission-denied", "An active IRPA identity or verified invitee is required.");
  if (!isAdmin && !invited && !designatedController) throw new HttpsError("permission-denied", "This account is not registered or subscribed to the selected meeting.");
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
  const controller = isAdmin || designatedController || moderatorForMeeting(meeting, uid, email, trustedModeratorRole);
  return { uid, email, meeting, isAdmin, invited, controller };
}
function recordingRoomName(meetingId) {
  return opaqueRoomName(meetingId, "shared-live-room");
}
function safeRecordingId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}
function egressState(info) {
  const value = info?.status;
  const numeric = Number(value);
  const names = { 0: "EGRESS_STARTING", 1: "EGRESS_ACTIVE", 2: "EGRESS_ENDING", 3: "EGRESS_COMPLETE", 4: "EGRESS_FAILED", 5: "EGRESS_ABORTED", 6: "EGRESS_LIMIT_REACHED" };
  return names[numeric] || text(value) || "UNKNOWN";
}
function recordingStateForEgress(info) {
  const state = egressState(info);
  if (state === "EGRESS_COMPLETE") return "COMPLETED";
  if (["EGRESS_FAILED", "EGRESS_ABORTED", "EGRESS_LIMIT_REACHED"].includes(state)) return "FAILED";
  if (state === "EGRESS_ENDING") return "STOPPING";
  if (state === "EGRESS_ACTIVE") return "RECORDING";
  return "STARTING";
}
exports.startMeetingRecording = onCall({
  region: "us-central1", timeoutSeconds: 60,
  secrets: [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_RECORDING_STORAGE_GCP_CREDENTIALS, LIVEKIT_RECORDING_STORAGE_GCP_BUCKET]
}, async request => {
  const ctx = await resolveRecordingControl(request, text(request.data?.meetingId));
  if (!ctx.controller) throw new HttpsError("permission-denied", "Only the meeting administrator, initiator, chairperson or secretary may start recording.");
  const storageConfig = recordingStorageConfig();
  const roomName = recordingRoomName(ctx.meeting.id);
  const activeRecordings = await db.collection("meetingMediaRecordings").where("meetingId", "==", ctx.meeting.id).get();
  const activeRecording = activeRecordings.docs.find(doc => ["STARTING", "RECORDING", "STOPPING"].includes(text(doc.data()?.recordingStatus)));
  if (activeRecording) {
    const active = activeRecording.data() || {};
    return {
      ok: true, alreadyActive: true, recordingId: active.egressId || activeRecording.id,
      egressId: active.egressId || activeRecording.id, recordingStatus: active.recordingStatus,
      outputPath: active.outputPath || null, storageDestination: active.storageDestination || "GOOGLE_CLOUD_STORAGE"
    };
  }
  const lockId = crypto.createHash("sha256").update(ctx.meeting.id).digest("hex");
  const lockRef = db.collection("meetingRecordingLocks").doc(lockId);
  const reservationId = crypto.randomBytes(16).toString("hex");
  await db.runTransaction(async tx => {
    const lockSnap = await tx.get(lockRef);
    const lockStatus = text(lockSnap.data()?.status).toUpperCase();
    if (["STARTING", "RECORDING", "STOPPING"].includes(lockStatus)) {
      throw new HttpsError("already-exists", "Recording start is already in progress for this meeting.");
    }
    tx.set(lockRef, {
      meetingId: ctx.meeting.id, status: "STARTING", reservationId,
      startedByUid: ctx.uid, updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filepath = "irpa-governance-recordings/" + safeRecordingId(ctx.meeting.id) + "/" + stamp + ".mp4";
  const output = recordingFileOutput(filepath);
  let egress;
  try {
    await ensureRecordingRoom(roomName);
    egress = await egressClient().startRoomCompositeEgress(
      roomName,
      { file: output.file },
      { layout: "grid", audioOnly: false }
    );
  } catch (error) {
    await lockRef.set({
      meetingId: ctx.meeting.id, reservationId, status: "FAILED",
      failureReason: text(error?.message).slice(0, 500), updatedAt: FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});
    await db.collection("audit").add({
      action: "LIVE_MEETING_RECORDING_START_FAILED", collection: "meetingMediaRecordings", recordId: null,
      details: { meetingId: ctx.meeting.id, reason: text(error?.message).slice(0, 500), storageDestination: "GOOGLE_CLOUD_STORAGE", storageBucket: storageConfig.bucket },
      actorUid: ctx.uid, actorEmail: ctx.email || null, createdAt: FieldValue.serverTimestamp()
    });
    throw new HttpsError("failed-precondition", "Recording could not start. Verify the LiveKit egress service and protected Google Cloud Storage configuration; proceedings were not marked live.");
  }
  const egressId = text(egress.egressId);
  if (!egressId) {
    await lockRef.set({ meetingId: ctx.meeting.id, reservationId, status: "FAILED", updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
    throw new HttpsError("internal", "LiveKit did not return a recording identifier.");
  }
  const row = {
    meetingId: ctx.meeting.id,
    meetingReference: text(ctx.meeting.meetingReference || ctx.meeting.reference || ctx.meeting.title),
    meetingTitle: text(ctx.meeting.title), meetingCategory: categoryOf(ctx.meeting), roomName,
    egressId, outputPath: filepath, storageBucket: storageConfig.bucket,
    recordingStatus: "RECORDING", egressStatus: egressState(egress),
    recordingProvider: "LIVEKIT_EGRESS", storageDestination: "GOOGLE_CLOUD_STORAGE",
    startedByUid: ctx.uid, startedByEmail: ctx.email || null,
    startedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  };
  try {
    await db.collection("meetingMediaRecordings").doc(egressId).set(row);
    await db.collection("meetings").doc(ctx.meeting.id).update({
      recordingStatus: "RECORDING", recordingEgressId: egressId,
      recordingStartedAt: FieldValue.serverTimestamp(), recordingStartedByUid: ctx.uid,
      recordingStorage: row.storageDestination, recordingStorageBucket: storageConfig.bucket,
      recordingOutputPath: filepath
    });
    await db.collection("audit").add({
      action: "LIVE_MEETING_RECORDING_STARTED", collection: "meetingMediaRecordings", recordId: egressId,
      details: { meetingId: ctx.meeting.id, meetingCategory: row.meetingCategory, egressId, outputPath: filepath, storageDestination: row.storageDestination, storageBucket: storageConfig.bucket },
      actorUid: ctx.uid, actorEmail: ctx.email || null, createdAt: FieldValue.serverTimestamp()
    });
    await lockRef.set({ meetingId: ctx.meeting.id, reservationId, egressId, status: "RECORDING", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  } catch (error) {
    try { await egressClient().stopEgress(egressId); } catch {}
    await db.collection("meetingMediaRecordings").doc(egressId).set({
      ...row, recordingStatus: "FAILED", failureReason: "Recording metadata/audit persistence failed."
    }, { merge: true }).catch(() => {});
    await lockRef.set({ meetingId: ctx.meeting.id, reservationId, egressId, status: "FAILED", updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
    throw new HttpsError("internal", "LiveKit started recording but IRPA could not persist the recording register. The egress was stopped; verify audit and recording status before retrying.");
  }
  return { ok: true, recordingId: egressId, egressId, recordingStatus: "RECORDING", outputPath: filepath, storageBucket: storageConfig.bucket, storageDestination: row.storageDestination };
});
exports.stopMeetingRecording = onCall({
  region: "us-central1", timeoutSeconds: 60,
  secrets: [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET]
}, async request => {
  const meetingId = text(request.data?.meetingId);
  const recordingId = text(request.data?.recordingId || request.data?.egressId);
  if (!recordingId) throw new HttpsError("invalid-argument", "Recording ID is required.");
  const ctx = await resolveRecordingControl(request, meetingId, { allowClosed: true });
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
  const egressStatus = egressState(result);
  const recordingStatus = recordingStateForEgress(result);
  const files = Array.isArray(result.fileResults) ? result.fileResults.map(file => ({
    filename: text(file.filename), location: text(file.location), size: Number(file.size || 0)
  })) : [];
  await ref.update({
    recordingStatus, egressStatus,
    fileResults: files, stoppedByUid: ctx.uid, stoppedByEmail: ctx.email || null,
    stopRequestedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  });
  const lockId = crypto.createHash("sha256").update(meetingId).digest("hex");
  await db.collection("meetingRecordingLocks").doc(lockId).set({ meetingId, egressId: recordingId, status: recordingStatus, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
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
  secrets: [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_RECORDING_STORAGE_GCP_CREDENTIALS, LIVEKIT_RECORDING_STORAGE_GCP_BUCKET]
}, async request => {
  const ctx = await resolveRecordingControl(request, text(request.data?.meetingId), { requireRecordingAllowed: false, allowClosed: true });
  if (!ctx.invited && !ctx.isAdmin && !ctx.controller) throw new HttpsError("permission-denied", "An authorised meeting participant is required to view recording status.");
  const snap = await db.collection("meetingMediaRecordings").where("meetingId", "==", ctx.meeting.id).get();
  const rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) =>
    (b.startedAt?.toMillis?.() || 0) - (a.startedAt?.toMillis?.() || 0)
  );
  let row = rows[0];
  if (!row) return { ok: true, recordingAllowed: ctx.meeting.recordingAllowed === true, recordingStatus: "NOT_STARTED", recording: null };
  if (row.egressId && ["RECORDING", "STOPPING", "STARTING"].includes(text(row.recordingStatus))) {
    try {
      const latest = (await egressClient().listEgress("", row.egressId)).find(item => text(item.egressId) === text(row.egressId));
      if (latest) {
        const nextStatus = recordingStateForEgress(latest);
        const files = Array.isArray(latest.fileResults) ? latest.fileResults.map(file => ({ filename: text(file.filename), location: text(file.location), size: Number(file.size || 0) })) : [];
        const patch = { recordingStatus: nextStatus, egressStatus: egressState(latest), fileResults: files, updatedAt: FieldValue.serverTimestamp() };
        if (nextStatus === "COMPLETED") patch.completedAt = FieldValue.serverTimestamp();
        await db.collection("meetingMediaRecordings").doc(row.id).update(patch);
        const lockId = crypto.createHash("sha256").update(ctx.meeting.id).digest("hex");
        await db.collection("meetingRecordingLocks").doc(lockId).set({ meetingId: ctx.meeting.id, egressId: row.egressId, status: nextStatus, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        await db.collection("meetings").doc(ctx.meeting.id).update({ recordingStatus: nextStatus, ...(nextStatus === "COMPLETED" ? { recordingCompletedAt: FieldValue.serverTimestamp() } : {}) });
        row = { ...row, ...patch, fileResults: files, recordingStatus: nextStatus, egressStatus: egressState(latest) };
      }
    } catch (error) {
      // Return the last persisted state if the Egress control plane is temporarily unavailable.
    }
  }
  return {
    ok: true, recordingAllowed: ctx.meeting.recordingAllowed === true,
    recordingStatus: row.recordingStatus || "UNKNOWN",
    recording: {
      id: row.id, egressId: row.egressId, outputPath: row.outputPath || null,
      storageBucket: row.storageBucket || null, storageDestination: row.storageDestination || null,
      status: row.recordingStatus || "UNKNOWN", egressStatus: row.egressStatus || null,
      startedAt: row.startedAt?.toDate?.().toISOString?.() || null,
      stoppedAt: row.stopRequestedAt?.toDate?.().toISOString?.() || null,
      files: Array.isArray(row.fileResults) ? row.fileResults.map(file => ({ filename: file.filename || "", location: file.location || "", size: file.size || 0 })) : []
    }
  };
});


/**
 * Return a short-lived signed URL only after server-side meeting/participant
 * authorization. The GCS bucket is private; object names and permissions never
 * come from an untrusted browser request.
 */
exports.getMeetingRecordingDownloadUrl = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  secrets: [LIVEKIT_RECORDING_STORAGE_GCP_CREDENTIALS, LIVEKIT_RECORDING_STORAGE_GCP_BUCKET]
}, async request => {
  const meetingId = text(request.data?.meetingId);
  const recordingId = text(request.data?.recordingId);
  if (!recordingId) throw new HttpsError("invalid-argument", "Recording ID is required.");
  const ctx = await resolveRecordingControl(request, meetingId, { requireRecordingAllowed: false, allowClosed: true });
  if (!ctx.isAdmin && !ctx.invited && !ctx.controller) {
    throw new HttpsError("permission-denied", "An authorised meeting participant is required to download this recording.");
  }
  const snap = await db.collection("meetingMediaRecordings").doc(recordingId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Meeting recording was not found.");
  const recording = snap.data() || {};
  if (text(recording.meetingId) !== meetingId) throw new HttpsError("permission-denied", "Recording does not belong to this meeting.");
  if (text(recording.recordingStatus).toUpperCase() !== "COMPLETED") {
    throw new HttpsError("failed-precondition", "The recording file is not yet confirmed complete.");
  }
  const filepath = text(recording.outputPath);
  const prefix = "irpa-governance-recordings/" + safeRecordingId(meetingId) + "/";
  if (!filepath.startsWith(prefix) || filepath.includes("..")) {
    throw new HttpsError("failed-precondition", "Recording storage path failed validation.");
  }
  const config = recordingStorageConfig();
  if (recording.storageBucket && recording.storageBucket !== config.bucket) {
    throw new HttpsError("failed-precondition", "Recording storage bucket does not match the configured private bucket.");
  }
  try {
    const storage = new Storage({
      projectId: config.credentials.project_id,
      credentials: { client_email: config.credentials.client_email, private_key: config.credentials.private_key }
    });
    const file = storage.bucket(config.bucket).file(filepath);
    const [exists] = await file.exists();
    if (!exists) throw new HttpsError("failed-precondition", "Recording egress completed, but the file is not yet present in private recording storage.");
    const [metadata] = await file.getMetadata();
    const sizeBytes = Number(metadata.size || 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new HttpsError("failed-precondition", "Recording storage contains an empty file; do not treat this recording as verified.");
    const filename = filepath.split("/").pop().replace(/["\\\\\r\n]/g, "_");
    const [downloadUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 5 * 60 * 1000,
      responseDisposition: `attachment; filename="${filename}"`
    });
    await db.collection("meetingMediaRecordings").doc(recordingId).update({storageVerification:"VERIFIED",storageSizeBytes:sizeBytes,storageVerifiedAt:FieldValue.serverTimestamp(),storageBucket:config.bucket,updatedAt:FieldValue.serverTimestamp()});
    await db.collection("meetings").doc(meetingId).update({recordingStorage:"GOOGLE_CLOUD_STORAGE",recordingStorageVerified:true,recordingStorageVerifiedAt:FieldValue.serverTimestamp(),recordingStorageSizeBytes:sizeBytes});
    await db.collection("audit").add({
      action: "LIVE_MEETING_RECORDING_DOWNLOAD_URL_ISSUED",
      collection: "meetingMediaRecordings",
      recordId: recordingId,
      details: { meetingId, outputPath: filepath, expiresInSeconds: 300, storageBucket: config.bucket, storageSizeBytes: sizeBytes, storageVerification: "VERIFIED" },
      actorUid: ctx.uid, actorEmail: ctx.email || null, createdAt: FieldValue.serverTimestamp()
    });
    return { ok: true, downloadUrl, filename, sizeBytes, storageBucket: config.bucket, storageVerification: "VERIFIED", expiresInSeconds: 300 };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", "A temporary recording download link could not be issued. Verify private storage access and signing credentials.");
  }
});
