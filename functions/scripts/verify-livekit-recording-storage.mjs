import admin from "firebase-admin";
import crypto from "node:crypto";
import { Room, AudioFrame, AudioSource, LocalAudioTrack, TrackPublishOptions, TrackSource, VideoBufferType, VideoFrame, VideoSource, LocalVideoTrack, dispose } from "@livekit/rtc-node";

const PROJECT_ID = "irpa-dbg-staging-a73ec";
const API_KEY = required("STAGING_FIREBASE_WEB_API_KEY");
const ACCOUNT_JSON = required("STAGING_FIREBASE_SERVICE_ACCOUNT");
const WORKER_URL = required("LIVEKIT_TOKEN_WORKER_URL").replace(/\/+$/, "");
const LIVEKIT_URL = required("LIVEKIT_URL");
const LIVEKIT_API_KEY = required("LIVEKIT_API_KEY");
const FUNCTIONS_ORIGIN = `https://us-central1-${PROJECT_ID}.cloudfunctions.net`;

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}
function roomNameForMeeting(meetingId) {
  const digest = crypto.createHash("sha256").update(`${meetingId}:shared-live-room`).digest("hex").slice(0, 32);
  return `irpa-meeting-${digest}`;
}
function normaliseServerUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "wss:" && url.protocol !== "https:") throw new Error("LiveKit server URL must be secure (wss:// or https://).");
  return `${url.protocol}//${url.host}`.replace(/^https:/, "wss:");
}
async function invokeCallable(name, idToken, data) {
  const response = await fetch(`${FUNCTIONS_ORIGIN}/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    const error = body.error?.message || body.error?.status || `HTTP_${response.status}`;
    throw new Error(`${name} failed: ${String(error).slice(0, 300)}`);
  }
  const result = body.result ?? body.data;
  if (!result) throw new Error(`${name} returned no callable result.`);
  return result;
}
async function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function main() {
  const serviceAccount = JSON.parse(ACCOUNT_JSON);
  if (serviceAccount.project_id !== PROJECT_ID) {
    throw new Error("Refusing recording acceptance test with a service account from another Firebase project.");
  }
  if (normaliseServerUrl(LIVEKIT_URL) === "") throw new Error("Invalid configured LiveKit URL.");

  const app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: PROJECT_ID
  }, `livekit-recording-smoke-${Date.now()}`);
  const auth = admin.auth(app);
  const db = admin.firestore(app);
  const suffix = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const email = `irpa-recording-smoke-${suffix}@example.com`;
  const meetingId = `irpa-recording-smoke-${suffix.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const roomName = roomNameForMeeting(meetingId);
  let user = null;
  let rtcRoom = null;
  let audioTrack = null;
  let videoTrack = null;
  let audioSource = null;
  let videoSource = null;
  let recordingId = "";
  let primaryFailure = null;
  let fixtureCreated = false;
  let downloadVerified = false;
  let mediaPublished = { audio: false, video: false };
  let dbCleanupOk = true;

  const cleanup = async () => {
    try { if (recordingId && user) await invokeCallable("stopMeetingRecording", await createIdToken(auth, user), { meetingId, recordingId }).catch(() => {}); } catch {}
    try { if (audioTrack) await audioTrack.close(); } catch {}
    try { if (videoTrack) await videoTrack.close(); } catch {}
    try { if (audioSource) await audioSource.close?.(); } catch {}
    try { if (videoSource) await videoSource.close?.(); } catch {}
    try { if (rtcRoom) await rtcRoom.disconnect(); } catch {}
    try { await dispose(); } catch {}
    if (fixtureCreated) {
      try {
        const snapshot = await db.collection("meetingMediaRecordings").where("meetingId", "==", meetingId).get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        const locks = await db.collection("meetingRecordingLocks").where("meetingId", "==", meetingId).get();
        locks.docs.forEach(doc => batch.delete(doc.ref));
        const audit = await db.collection("audit").where("details.meetingId", "==", meetingId).get();
        audit.docs.forEach(doc => {
          if (String(doc.data().action || "").startsWith("LIVE_MEETING_")) batch.delete(doc.ref);
        });
        if (snapshot.size || locks.size || audit.size) await batch.commit();
        await db.collection("meetings").doc(meetingId).delete();
        if (user) await db.collection("members").doc(user.uid).delete();
      } catch (error) {
        dbCleanupOk = false;
        console.error("TEST CLEANUP WARNING: staging fixture cleanup needs review:", error?.message || "unknown error");
      }
      if (user) {
        try { await auth.deleteUser(user.uid); }
        catch { dbCleanupOk = false; }
      }
    }
    try { await app.delete(); } catch {}
  };

  try {
    user = await auth.createUser({
      email, emailVerified: true, displayName: "Temporary IRPA recording acceptance test", disabled: false
    });
    await db.collection("members").doc(user.uid).set({
      uid: user.uid, email, status: "Active", role: "Board Chairperson",
      boardPosition: "Board Chairperson", name: "Temporary IRPA recording acceptance test",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await db.collection("meetings").doc(meetingId).set({
      title: "Temporary LiveKit audio/video recording acceptance",
      status: "In Progress", meetingCategory: "GOVERNANCE", meetingPolicyId: "GOVERNANCE",
      meetingPlatform: "IRPA-DBGS Meeting Room",
      initiatorUid: user.uid, initiatorEmail: email, chairpersonUid: user.uid,
      participantUids: [user.uid], invitedUids: [user.uid], recordingAllowed: true,
      recordingPolicyVersion: "IRPA-AUTO-RECORDING-1.0",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    fixtureCreated = true;

    const customToken = await auth.createCustomToken(user.uid);
    const exchange = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(API_KEY)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
    );
    const exchangeBody = await exchange.json().catch(() => ({}));
    if (!exchange.ok || !exchangeBody.idToken) throw new Error(`Staging Firebase ID-token exchange failed: ${exchangeBody.error?.message || exchange.status}`);
    const idToken = exchangeBody.idToken;

    const tokenResponse = await fetch(`${WORKER_URL}/token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json", Origin: "https://irpa-dgb-meeting-room-staging.irpa-governance.workers.dev" },
      body: JSON.stringify({ meetingId, selectedAuthority: "Board Chairperson" })
    });
    const tokenBody = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || tokenBody.ok !== true) throw new Error(`LiveKit participant token request failed: HTTP_${tokenResponse.status} ${String(tokenBody.error || "invalid response")}`);
    if (!tokenBody.serverUrl || !tokenBody.participantToken || tokenBody.moderator !== true) throw new Error("LiveKit token issuer did not return a moderator token and secure media URL.");

    const jwtParts = String(tokenBody.participantToken).split(".");
    if (jwtParts.length !== 3) throw new Error("LiveKit participant token was malformed.");
    const claims = decodeJwtPart(jwtParts[1]);
    const expectedUrl = normaliseServerUrl(LIVEKIT_URL);
    const issuedUrl = normaliseServerUrl(tokenBody.serverUrl);
    if (expectedUrl !== issuedUrl || claims.iss !== LIVEKIT_API_KEY) {
      throw new Error("Firebase recording callables and the Cloudflare token issuer are configured for different LiveKit credentials/hosts. No test recording was started.");
    }
    if (claims.video?.room !== roomName || claims.video?.roomJoin !== true) {
      throw new Error("The token issuer and recording backend do not resolve the same authorised room.");
    }

    rtcRoom = new Room();
    await rtcRoom.connect(tokenBody.serverUrl, tokenBody.participantToken, { autoSubscribe: true, dynacast: true });

    // Publish deterministic synthetic audio and video so the test verifies an
    // actual media egress rather than an empty or silent room.
    const sampleRate = 48000;
    const channels = 1;
    const samplesPerFrame = 480;
    audioSource = new AudioSource(sampleRate, channels);
    audioTrack = LocalAudioTrack.createAudioTrack("acceptance-tone", audioSource);
    const audioOptions = new TrackPublishOptions();
    audioOptions.source = TrackSource.SOURCE_MICROPHONE;
    await rtcRoom.localParticipant.publishTrack(audioTrack, audioOptions);
    mediaPublished.audio = true;

    const width = 320, height = 180;
    videoSource = new VideoSource(width, height);
    videoTrack = LocalVideoTrack.createVideoTrack("acceptance-video", videoSource);
    const videoOptions = new TrackPublishOptions();
    videoOptions.source = TrackSource.SOURCE_CAMERA;
    await rtcRoom.localParticipant.publishTrack(videoTrack, videoOptions);
    mediaPublished.video = true;

    const start = await invokeCallable("startMeetingRecording", idToken, {
      meetingId, selectedAuthority: "Board Chairperson"
    });
    recordingId = String(start.recordingId || start.egressId || "");
    if (start.ok !== true || !recordingId || start.recordingStatus !== "RECORDING") {
      throw new Error("Recording callable did not confirm an active Egress recording.");
    }

    const audioFrames = sampleRate * 8 / samplesPerFrame;
    const startTime = Date.now();
    let frameIndex = 0;
    while (Date.now() - startTime < 8000) {
      const data = new Int16Array(samplesPerFrame);
      for (let i = 0; i < samplesPerFrame; i++) {
        data[i] = Math.round(12000 * Math.sin(2 * Math.PI * 440 * ((frameIndex * samplesPerFrame) + i) / sampleRate));
      }
      await audioSource.captureFrame(new AudioFrame(data, sampleRate, channels, samplesPerFrame));
      const video = new Uint8Array(width * height * 3 / 2);
      const y = 16 + (frameIndex % 180);
      video.fill(128);
      video.fill(y, 0, width * height);
      videoSource.captureFrame(new VideoFrame(video, width, height, VideoBufferType.I420));
      frameIndex++;
      await sleep(10);
    }
    await audioSource.waitForPlayout?.();

    await invokeCallable("stopMeetingRecording", idToken, { meetingId, recordingId, selectedAuthority: "Board Chairperson" });

    let finalStatus = "STOPPING";
    let verifiedResponse = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      await sleep(3000);
      const state = await invokeCallable("getMeetingRecordingStatus", idToken, { meetingId });
      finalStatus = String(state.recordingStatus || state.recording?.status || "UNKNOWN").toUpperCase();
      if (finalStatus === "FAILED") throw new Error("LiveKit Egress reported a failed recording.");
      if (finalStatus === "COMPLETED") {
        try {
          verifiedResponse = await invokeCallable("getMeetingRecordingDownloadUrl", idToken, { meetingId, recordingId });
          if (verifiedResponse.storageVerification === "VERIFIED" && Number(verifiedResponse.sizeBytes) > 0) {
            downloadVerified = true;
            break;
          }
        } catch (error) {
          if (attempt === 39) throw error;
        }
      }
    }
    if (!downloadVerified) throw new Error(`Recording did not reach verified, non-empty private storage (last status: ${finalStatus}).`);

    console.log(JSON.stringify({
      ok: true,
      check: "livekit-audio-video-recording-storage-e2e",
      firebaseProject: PROJECT_ID,
      roomConnection: "passed",
      publishedAudio: mediaPublished.audio,
      publishedVideo: mediaPublished.video,
      recordingStartConfirmed: true,
      recordingStopConfirmed: true,
      egressStatus: finalStatus,
      privateStorageObject: "verified",
      storageSizeBytes: verifiedResponse.sizeBytes,
      shortLivedDownloadAuthorization: "passed",
      recordingId,
      cleanup: "pending"
    }, null, 2));
  } catch (error) {
    primaryFailure = error;
  } finally {
    await cleanup();
  }

  if (!dbCleanupOk) primaryFailure ||= new Error("The temporary staging acceptance fixture could not be fully removed.");
  if (primaryFailure) {
    console.error(JSON.stringify({
      ok: false,
      check: "livekit-audio-video-recording-storage-e2e",
      stage: "room connection / media publishing / egress / storage verification",
      error: primaryFailure.message || "Unknown failure",
      cleanup: dbCleanupOk ? "completed" : "needs review"
    }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ cleanup: "temporary user, meeting, recording metadata, lock, and audit records removed" }));
  }
}

async function createIdToken(auth, user) {
  const customToken = await auth.createCustomToken(user.uid);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(API_KEY)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.idToken) throw new Error(`Could not refresh cleanup authentication token: ${body.error?.message || response.status}`);
  return body.idToken;
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, check: "livekit-audio-video-recording-storage-e2e", error: error?.message || "Unknown failure" }, null, 2));
  process.exitCode = 1;
});
