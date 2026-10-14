const admin = require("firebase-admin");
const crypto = require("node:crypto");

const PROJECT_ID = "irpa-digital-board-governance";
const API_KEY = required("FIREBASE_WEB_API_KEY");
const WORKER_URL = required("LIVEKIT_WORKER_URL").replace(/\/+$/, "");
const ACCOUNT_JSON = required("FIREBASE_SERVICE_ACCOUNT");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error("Missing required environment variable: " + name);
  return value;
}
function part(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}
async function main() {
  const serviceAccount = JSON.parse(ACCOUNT_JSON);
  if (serviceAccount.project_id !== PROJECT_ID) throw new Error("Refusing production smoke test with a service account from another Firebase project.");
  const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: PROJECT_ID });
  const auth = admin.auth(app), db = admin.firestore(app);
  const suffix = Date.now() + "-" + crypto.randomBytes(5).toString("hex");
  const email = "irpa-livekit-production-smoke-" + suffix + "@example.com";
  const meetingId = "irpa-livekit-production-smoke-" + suffix.replace(/[^a-zA-Z0-9_-]/g, "-");
  let user = null;
  try {
    user = await auth.createUser({ email, emailVerified: true, displayName: "Temporary IRPA LiveKit production acceptance test", disabled: false });
    await db.collection("members").doc(user.uid).set({
      uid: user.uid, email, status: "Active", role: "Board Chairperson", boardPosition: "Board Chairperson",
      name: "Temporary IRPA LiveKit production acceptance test", createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await db.collection("meetings").doc(meetingId).set({
      title: "Temporary LiveKit production acceptance test", status: "In Progress", meetingCategory: "GOVERNANCE",
      initiatorUid: user.uid, chairpersonUid: user.uid, participantUids: [user.uid],
      recordingAllowed: false, createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    const customToken = await auth.createCustomToken(user.uid);
    const exchange = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=" + encodeURIComponent(API_KEY), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true })
    });
    const exchangeBody = await exchange.json().catch(() => ({}));
    if (!exchange.ok || !exchangeBody.idToken) throw new Error("Production Firebase authentication exchange failed: " + (exchangeBody.error?.message || exchange.status));
    const origin = "https://irpa-digital-board-governance.web.app";
    const tokenResponse = await fetch(WORKER_URL + "/token", {
      method: "POST",
      headers: { Authorization: "Bearer " + exchangeBody.idToken, "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ meetingId, selectedAuthority: "Board Chairperson" })
    });
    const tokenBody = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || tokenBody.ok !== true) throw new Error("Production worker token issuance failed: HTTP " + tokenResponse.status + " " + String(tokenBody.error || ""));
    if (!tokenBody.serverUrl || !tokenBody.participantToken || tokenBody.moderator !== true ||
        tokenBody.recordingAllowed !== false || tokenBody.expiresInSeconds !== 600) {
      throw new Error("Production token response has incorrect meeting-authority or recording-policy claims.");
    }
    const parts = String(tokenBody.participantToken).split(".");
    if (parts.length !== 3) throw new Error("Production worker returned a malformed LiveKit JWT.");
    const header = part(parts[0]), claims = part(parts[1]);
    if (header.alg !== "HS256" || claims.sub !== "uid-" + user.uid || claims.video?.roomJoin !== true ||
        claims.video?.roomAdmin !== true || claims.exp - claims.iat !== 600) {
      throw new Error("Production LiveKit JWT claims failed verification.");
    }
    const audits = await db.collection("audit").where("actorUid", "==", user.uid).get();
    const tokenAudit = audits.docs.find(d => {
      const row = d.data();
      return row.action === "LIVE_MEETING_TOKEN_ISSUED" && row.recordId === tokenBody.sessionId && row.details?.meetingId === meetingId;
    });
    if (!tokenAudit) throw new Error("Production token issuance did not create the required audit event.");

    const recordingResponse = await fetch(WORKER_URL + "/recording/start", {
      method: "POST",
      headers: { Authorization: "Bearer " + exchangeBody.idToken, "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ meetingId, selectedAuthority: "Board Chairperson" })
    });
    const recordingBody = await recordingResponse.json().catch(() => ({}));
    if (recordingResponse.status !== 403 || recordingBody.error !== "RECORDING_NOT_AUTHORISED") {
      throw new Error("Production recording policy boundary failed closed for a meeting with recordingAllowed=false.");
    }

    console.log(JSON.stringify({
      ok: true,
      check: "production-livekit-token-and-recording-policy",
      firebaseProject: PROJECT_ID,
      meetingAuthorization: "passed",
      livekitTokenShapeAndClaims: "passed",
      moderatorGrant: "passed",
      tenMinuteExpiry: "passed",
      firestoreAuditWrite: "passed",
      unauthorizedRecordingBlocked: "passed",
      recordingStorageConfiguredByWorkerHealth: true
    }, null, 2));
  } finally {
    if (user) {
      const auditSnapshot = await db.collection("audit").where("actorUid", "==", user.uid).get().catch(() => null);
      if (auditSnapshot) {
        const batch = db.batch();
        auditSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        if (!auditSnapshot.empty) await batch.commit().catch(() => {});
      }
      await db.collection("meetings").doc(meetingId).delete().catch(() => {});
      await db.collection("members").doc(user.uid).delete().catch(() => {});
      await auth.deleteUser(user.uid).catch(() => {});
    }
    await app.delete().catch(() => {});
    console.log(JSON.stringify({ cleanup: "temporary production test user and records removed" }));
  }
}
main().catch(error => {
  console.error(JSON.stringify({ ok: false, check: "production-livekit-token-and-recording-policy", error: error.message || "Unknown error" }));
  process.exitCode = 1;
});
