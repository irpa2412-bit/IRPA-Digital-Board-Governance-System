const admin = require("firebase-admin");
const crypto = require("node:crypto");

const PROJECT_ID = "irpa-dbg-staging-a73ec";
const API_KEY = required("STAGING_FIREBASE_WEB_API_KEY");
const WORKER_URL = required("LIVEKIT_TOKEN_WORKER_URL").replace(/\/+$/, "");
const ACCOUNT_JSON = required("STAGING_FIREBASE_SERVICE_ACCOUNT");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

async function main() {
  const serviceAccount = JSON.parse(ACCOUNT_JSON);
  if (serviceAccount.project_id !== PROJECT_ID) {
    throw new Error("Refusing to run staging smoke test with a service account from another Firebase project.");
  }

  const app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: PROJECT_ID
  });
  const auth = admin.auth(app);
  const db = admin.firestore(app);

  const suffix = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
  const email = `irpa-livekit-smoke-${suffix}@example.com`;
  const meetingId = `irpa-lk-smoke-${suffix.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  let user = null;
  let failure = null;
  let auditWritten = false;

  try {
    user = await auth.createUser({
      email,
      emailVerified: true,
      displayName: "Temporary IRPA LiveKit staging verification",
      disabled: false
    });

    await db.collection("members").doc(user.uid).set({
      uid: user.uid,
      email,
      status: "Active",
      role: "Board Chairperson",
      boardPosition: "Board Chairperson",
      name: "Temporary IRPA LiveKit staging verification",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await db.collection("meetings").doc(meetingId).set({
      title: "Temporary LiveKit staging token verification",
      status: "In Progress",
      meetingCategory: "GOVERNANCE",
      initiatorUid: user.uid,
      chairpersonUid: user.uid,
      participantUids: [user.uid],
      recordingAllowed: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const customToken = await auth.createCustomToken(user.uid);
    const exchange = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true })
      }
    );

    const exchangeBody = await exchange.json().catch(() => ({}));
    if (!exchange.ok || !exchangeBody.idToken) {
      const message = exchangeBody.error?.message || `HTTP_${exchange.status}`;
      throw new Error(`Staging Firebase sign-in exchange failed: ${message}`);
    }

    const tokenResponse = await fetch(`${WORKER_URL}/token`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${exchangeBody.idToken}`,
        "Content-Type": "application/json",
        Origin: "https://irpa-dgb-meeting-room-staging.irpa-governance.workers.dev"
      },
      body: JSON.stringify({
        meetingId,
        selectedAuthority: "Board Chairperson"
      })
    });

    const tokenBody = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || tokenBody.ok !== true) {
      throw new Error(
        `Authenticated Cloudflare token request failed: HTTP_${tokenResponse.status} ${String(tokenBody.error || "INVALID_RESPONSE")}`
      );
    }

    if (
      !tokenBody.serverUrl ||
      !tokenBody.participantToken ||
      tokenBody.moderator !== true ||
      tokenBody.recordingAllowed !== false ||
      tokenBody.expiresInSeconds !== 600
    ) {
      throw new Error("Worker returned an incomplete or incorrect staged token response.");
    }

    const parts = String(tokenBody.participantToken).split(".");
    if (parts.length !== 3) throw new Error("Worker returned a malformed LiveKit JWT.");

    const jwtHeader = decodeJwtPart(parts[0]);
    const jwtClaims = decodeJwtPart(parts[1]);

    if (
      jwtHeader.alg !== "HS256" ||
      jwtClaims.iss !== process.env.EXPECTED_LIVEKIT_API_KEY ||
      jwtClaims.sub !== `uid-${user.uid}` ||
      jwtClaims.video?.roomJoin !== true ||
      jwtClaims.video?.roomAdmin !== true ||
      !Number.isFinite(jwtClaims.exp) ||
      !Number.isFinite(jwtClaims.iat) ||
      jwtClaims.exp - jwtClaims.iat !== 600
    ) {
      throw new Error("Issued LiveKit JWT claims did not match the expected staging authorization.");
    }

    const auditSnapshot = await db.collection("audit")
      .where("actorUid", "==", user.uid)
      .get();

    auditWritten = auditSnapshot.docs.some(doc => {
      const row = doc.data();
      return row.action === "LIVE_MEETING_TOKEN_ISSUED" &&
        row.recordId === tokenBody.sessionId &&
        row.details?.meetingId === meetingId;
    });

    if (!auditWritten) throw new Error("No matching Firestore audit entry was persisted.");

    console.log(JSON.stringify({
      ok: true,
      check: "cloudflare-livekit-authenticated-token-and-audit",
      firebaseProject: PROJECT_ID,
      meetingAuthorization: "passed",
      livekitTokenShapeAndClaims: "passed",
      moderatorGrant: "passed",
      tenMinuteExpiry: "passed",
      firestoreAuditWrite: "passed",
      recordingPolicyPreserved: true
    }, null, 2));
  } catch (error) {
    failure = error;
  } finally {
    if (user) {
      try {
        const audit = await db.collection("audit").where("actorUid", "==", user.uid).get();
        const batch = db.batch();
        for (const doc of audit.docs) {
          if (doc.data().action === "LIVE_MEETING_TOKEN_ISSUED") batch.delete(doc.ref);
        }
        if (!batch.isEmpty) await batch.commit();
      } catch (error) {
        console.error("TEST CLEANUP WARNING: audit record cleanup needs review:", error?.message || "unknown");
        failure ||= new Error("Test cleanup could not remove all temporary audit records.");
      }

      try {
        await db.collection("meetings").doc(meetingId).delete();
        await db.collection("members").doc(user.uid).delete();
        await auth.deleteUser(user.uid);
      } catch (error) {
        console.error("TEST CLEANUP WARNING: temporary staging records need review:", error?.message || "unknown");
        failure ||= new Error("Test cleanup could not remove all temporary staging records.");
      }
    }
    await app.delete();
  }

  if (failure) throw failure;
  console.log(JSON.stringify({ cleanup: "temporary staging user and fixture records removed" }));
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    check: "cloudflare-livekit-authenticated-token-and-audit",
    error: error?.message || "Unknown verification failure"
  }, null, 2));
  process.exitCode = 1;
});
