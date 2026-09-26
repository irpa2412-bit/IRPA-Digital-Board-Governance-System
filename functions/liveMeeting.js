const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { AccessToken } = require("livekit-server-sdk");
const crypto = require("crypto");

const db = getFirestore();

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
  return Boolean(text(process.env.LIVEKIT_URL) && text(process.env.LIVEKIT_API_KEY) && text(process.env.LIVEKIT_API_SECRET));
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
  enforceAppCheck: false
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

  const isAdmin = request.auth?.token?.admin === true || email === "irpa2412@gmail.com";
  const activeIdentity = isAdmin || records.some(activeRecord);
  if (!activeIdentity) throw new HttpsError("permission-denied", "An active IRPA member or employee identity is required.");

  const listed = participantListed(meeting, uid);
  if (!isAdmin && !listed) {
    throw new HttpsError("permission-denied", "This account is not registered as a participant in the selected meeting.");
  }

  if (!isAdmin && selectedAuthority && !records.some(record => selectedAuthorityMatches(record, selectedAuthority))) {
    throw new HttpsError("permission-denied", "The selected access authority is not registered to this account.");
  }

  const sessionRef = db.collection("liveMeetingSessions").doc();
  const roomName = opaqueRoomName(meetingId, sessionRef.id);
  const participantIdentity = `uid-${uid}`;

  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: participantIdentity,
    name: text(meeting.displayName || meeting.title || "IRPA participant"),
    ttl: "10m"
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  });

  const participantLabel = selectedAuthority || "Meeting Participant";
  await sessionRef.set({
    meetingId,
    meetingReference: text(meeting.reference || meeting.title) || null,
    roomName,
    participantUid: uid,
    participantIdentity,
    participantAuthority: participantLabel,
    createdByUid: uid,
    createdAt: FieldValue.serverTimestamp(),
    status: "Token Issued",
    tokenTtl: "10m",
    mediaEngine: "LiveKit",
    mediaEndpoint: text(process.env.LIVEKIT_URL),
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
    serverUrl: text(process.env.LIVEKIT_URL),
    participantToken: await token.toJwt(),
    expiresInSeconds: 600
  };
});
