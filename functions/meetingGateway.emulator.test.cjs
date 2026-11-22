const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { initializeApp, getApps } = require("firebase-admin/app");
if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-irpa-staging" });
const { getFirestore } = require("firebase-admin/firestore");
const db = getFirestore();
const gateway = require("./meetingGateway");

const hash = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const future = () => new Date(Date.now() + 60 * 60 * 1000);
const auth = (uid, email) => ({ uid, token: { email } });
async function seedCase(suffix, mode, boundUid) {
  const meetingId = "emulator-meeting-" + suffix;
  const participantId = "emulator-participant-" + suffix;
  const accessId = "emulator-access-" + suffix;
  const token = "emulator-token-" + suffix;
  const password = "EmulatorPass-" + suffix;
  const hostUid = "emulator-host-" + suffix;
  const inviteeUid = "emulator-invitee-" + suffix;
  const hostEmail = hostUid + "@example.test";
  const inviteeEmail = inviteeUid + "@example.test";
  await db.collection("meetings").doc(meetingId).set({
    reference: "EMULATOR-" + suffix, title: "Emulator meeting " + suffix,
    status: "Scheduled", meetingEntryMode: mode, initiatorUid: hostUid,
    initiatorEmail: hostEmail
  });
  await db.collection("participants").doc(participantId).set({
    participantName: "Fixture Participant", participantEmail: inviteeEmail,
    participantUid: boundUid === undefined ? inviteeUid : boundUid
  });
  await db.collection("meetingAccessTokens").doc(accessId).set({
    meetingId, meetingReference: "EMULATOR-" + suffix, participantId,
    participantEmail: inviteeEmail, participantUid: boundUid === undefined ? inviteeUid : boundUid,
    tokenHash: hash(token), passwordHash: hash(password), status: "Active",
    expiresAt: future(), createdByUid: hostUid
  });
  return { meetingId, participantId, accessId, token, password, hostUid, hostEmail, inviteeUid, inviteeEmail };
}
async function authorize(row, uid=row.inviteeUid, email=row.inviteeEmail) {
  return gateway.authorizeMeetingEntry.run({
    auth: auth(uid, email),
    data: { accessToken: row.token, meetingId: row.meetingId, meetingPassword: row.password }
  });
}
async function cleanup(rows) {
  for (const row of rows) {
    const requestId = hash("meeting-entry:" + row.accessId + ":" + row.inviteeUid);
    await Promise.all([
      db.collection("meetings").doc(row.meetingId).delete(),
      db.collection("participants").doc(row.participantId).delete(),
      db.collection("meetingAccessTokens").doc(row.accessId).delete(),
      db.collection("meetingEntryRequests").doc(requestId).delete()
    ]);
  }
}

test("Firestore emulator: host admission, rejection, direct entry and participant identity binding", async () => {
  const admitted = await seedCase("admit", "HOST_APPROVAL");
  const rejected = await seedCase("reject", "HOST_APPROVAL");
  const direct = await seedCase("direct", "DIRECT");
  const mismatch = await seedCase("mismatch", "DIRECT", "different-bound-uid");
  const rows = [admitted, rejected, direct, mismatch];
  try {
    const pending = await authorize(admitted);
    assert.equal(pending.entryState, "WAITING_FOR_HOST");
    assert.ok(pending.entryRequestId);
    const admitResult = await gateway.resolveMeetingEntryRequest.run({
      auth: auth(admitted.hostUid, admitted.hostEmail),
      data: { requestId: pending.entryRequestId, decision: "ADMIT" }
    });
    assert.equal(admitResult.status, "ADMITTED");
    assert.equal((await authorize(admitted)).entryState, "AUTHORIZED");

    const rejectPending = await authorize(rejected);
    const denyResult = await gateway.resolveMeetingEntryRequest.run({
      auth: auth(rejected.hostUid, rejected.hostEmail),
      data: { requestId: rejectPending.entryRequestId, decision: "DENY" }
    });
    assert.equal(denyResult.status, "DENIED");
    await assert.rejects(() => authorize(rejected), error =>
      String(error.code || "").includes("permission-denied") && /declined this entry request/i.test(error.message));

    const directResult = await authorize(direct);
    assert.equal(directResult.entryMode, "DIRECT");
    assert.equal(directResult.entryState, "AUTHORIZED");

    await assert.rejects(() => authorize(mismatch), error =>
      String(error.code || "").includes("permission-denied") && /different participant identity/i.test(error.message));
  } finally {
    await cleanup(rows);
  }
});
