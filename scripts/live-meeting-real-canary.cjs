const fs = require("node:fs");
const crypto = require("node:crypto");
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const TITLE = "SYSTEM CANARY: REAL RECORD PROTECTION TEST";
const LABEL = "IRPA-DBGS SYSTEM CANARY — REAL RECORD PROTECTION";
const PROJECT = "irpa-digital-board-governance";
const output = (key, value) => fs.appendFileSync(process.env.GITHUB_OUTPUT, key + "=" + String(value) + "\n");
const summary = lines => fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");

async function post(path, body, idToken) {
  try {
    const response = await fetch(process.env.GATEWAY_URL + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + idToken,
        "Content-Type": "application/json",
        Origin: process.env.WEB_ORIGIN
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000)
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  } catch {
    return { status: 0, body: {} };
  }
}

(async () => {
  const results = {};
  let liveCheckFailed = false;
  let meetingRef = null;
  let meetingData = null;
  let meetingId = "NOT_CREATED";
  let recordRef = null;
  let recordId = "NOT_CREATED";
  let recordOriginal = null;
  let db = null;
  let fatalError = null;

  try {
    const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || "");
    if (!raw || !process.env.FIREBASE_WEB_API_KEY) throw new Error("Approved Firebase administrator credential path is unavailable.");
    const serviceAccount = JSON.parse(raw);
    if (serviceAccount.project_id !== PROJECT) throw new Error("Firebase service account project mismatch.");
    initializeApp({ credential: cert(serviceAccount), projectId: PROJECT });

    const auth = getAuth();
    const admin = await auth.getUserByEmail("irpa2412@gmail.com");
    if (admin.customClaims?.admin !== true) throw new Error("Primary administrator claim is not present; refusing canary.");
    const customToken = await auth.createCustomToken(admin.uid);
    const signIn = await fetch(
      "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=" + encodeURIComponent(process.env.FIREBASE_WEB_API_KEY),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Referer: process.env.WEB_ORIGIN + "/" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true })
      }
    );
    const signInBody = await signIn.json().catch(() => ({}));
    if (!signIn.ok || !signInBody.idToken) throw new Error("Firebase administrator session could not be established (HTTP " + signIn.status + ").");
    const idToken = signInBody.idToken;
    db = getFirestore();

    const prior = await db.collection("meetings").where("systemTestLabel", "==", LABEL).limit(2).get();
    if (prior.size > 1) throw new Error("Multiple labelled canary meetings exist; refusing to choose or create another.");
    if (!prior.empty) {
      const existing = prior.docs[0];
      meetingId = existing.id;
      meetingRef = existing.ref;
      meetingData = existing.data();
      if (meetingData.title !== TITLE) throw new Error("Existing labelled canary has an unexpected title; refusing to mutate it.");
      results.reusedExistingMeeting = true;
    } else {
      meetingId = "system-canary-" + crypto.randomUUID();
      meetingRef = db.collection("meetings").doc(meetingId);
      const now = new Date();
      meetingData = {
        title: TITLE, meetingType: "SYSTEM_CANARY", meetingCategory: "OTHER", meetingPolicyId: "OTHER",
        meetingReference: "SYSTEM-CANARY-" + meetingId.slice(-12).toUpperCase(),
        meetingIdentity: "IRPA-SYSTEM-CANARY-" + meetingId.slice(-12).toUpperCase(),
        date: now.toISOString().slice(0, 10), meetingDate: now.toISOString().slice(0, 10),
        status: "Cancelled", registerStatus: "Registered", initiatorUid: admin.uid,
        meetingHostUid: admin.uid, createdByUid: admin.uid, confidentialityClass: "INTERNAL",
        systemTest: true, systemTestLabel: LABEL, systemTestStatus: "CREATED", canary: true,
        legalHold: true, legalHoldReason: "System canary protection test; preserve this record.",
        createdAt: FieldValue.serverTimestamp(), registeredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
        // Deliberately omit environment: absence must classify as REAL.
      };
      await meetingRef.create(meetingData);
    }
    const initialMeeting = await meetingRef.get();
    results.missingEnvironment = initialMeeting.exists && initialMeeting.get("environment") === undefined;
    if (!results.missingEnvironment) {
      liveCheckFailed = true;
      throw new Error("Canary meeting is absent or has an environment field; refusing unsafe checks.");
    }

    const deletion = await post("/api/meeting-register/delete", { meetingId }, idToken);
    results.realMeetingDelete = deletion.status === 409 &&
      /explicitly TRIAL/i.test(String(deletion.body.error || ""));
    console.log("REAL_MEETING_DELETE_REFUSAL=" + (results.realMeetingDelete ? "PASS" : "FAIL") + "; HTTP=" + deletion.status);
    if (!results.realMeetingDelete) liveCheckFailed = true;

    // Restore the meeting before continuing if an unexpected delete removed it.
    if (!(await meetingRef.get()).exists) {
      await meetingRef.set({ ...meetingData, environment: FieldValue.delete() }, { merge: true });
    }

    const priorRecords = await db.collection("meetingRecords")
      .where("systemTestLabel", "==", LABEL)
      .where("meetingId", "==", meetingId)
      .limit(2)
      .get();
    if (priorRecords.size > 1) throw new Error("Multiple labelled canary records exist for this meeting; refusing to create another.");
    if (!priorRecords.empty) {
      recordRef = priorRecords.docs[0].ref;
      recordId = priorRecords.docs[0].id;
      recordOriginal = priorRecords.docs[0].data();
      results.reusedExistingRecord = true;
    } else {
      const capture = await post("/api/meeting-records/capture", {
        meetingId, recordType: "OTHER", title: TITLE,
        content: "System-test-only record created to verify that records linked to a REAL or unclassified meeting cannot be purged. Preserve this record."
      }, idToken);
      if (capture.status !== 200 || capture.body.ok !== true || !capture.body.recordId) {
        liveCheckFailed = true;
        results.recordCapture = false;
        console.log("CANARY_RECORD_CAPTURE=FAIL; HTTP=" + capture.status);
        throw new Error("Could not create the single linked system-test record required for the purge check.");
      }
      recordId = String(capture.body.recordId);
      recordRef = db.collection("meetingRecords").doc(recordId);
      const recordSnapshot = await recordRef.get();
      if (!recordSnapshot.exists) {
        liveCheckFailed = true;
        throw new Error("Worker did not persist the canary meeting record.");
      }
      recordOriginal = recordSnapshot.data();
      results.recordCapture = true;
    }

    // The isolated canary is eligible for purge only if the REAL-meeting guard is bypassed.
    await recordRef.update({
      legalHold: false,
      retainUntil: new Date("2000-01-01T00:00:00.000Z"),
      deletionStatus: "PENDING_REVIEW",
      systemTest: true,
      systemTestLabel: LABEL
    });
    const purge = await post("/api/meeting-records/dispose", { recordId, operation: "PURGE" }, idToken);
    results.realMeetingPurge = purge.status === 409 &&
      /REAL or unclassified meetings cannot be purged/i.test(String(purge.body.error || ""));
    console.log("REAL_MEETING_PURGE_REFUSAL=" + (results.realMeetingPurge ? "PASS" : "FAIL") + "; HTTP=" + purge.status);
    if (!results.realMeetingPurge) liveCheckFailed = true;

    const environmentAttempt = await post("/api/meeting-register/update", {
      meetingId,
      data: { environment: "TRIAL" }
    }, idToken);
    const afterAttempt = await meetingRef.get();
    const resultingEnvironment = afterAttempt.get("environment");
    const changedFields = environmentAttempt.body?.changedFields;
    results.trialEnvironmentMutationBlocked =
      resultingEnvironment !== "TRIAL" &&
      ((environmentAttempt.status === 200 && Array.isArray(changedFields) && !changedFields.includes("environment")) ||
       (environmentAttempt.status === 409 && /environment/i.test(String(environmentAttempt.body.error || ""))));
    console.log("TRIAL_ENVIRONMENT_MUTATION_BLOCKED=" + (results.trialEnvironmentMutationBlocked ? "PASS" : "FAIL") +
      "; HTTP=" + environmentAttempt.status + "; persistedEnvironment=" + (resultingEnvironment || "ABSENT"));
    if (!results.trialEnvironmentMutationBlocked) liveCheckFailed = true;
  } catch (error) {
    fatalError = String(error?.message || "Canary setup or execution failed.");
    console.error("CANARY_EXECUTION_ERROR: " + fatalError);
  } finally {
    // Never clean up the canary. Recreate/restore it if a guard unexpectedly removed it.
    if (db && meetingRef && meetingData) {
      try {
        await meetingRef.set({
          ...meetingData,
          environment: FieldValue.delete(),
          legalHold: true,
          legalHoldReason: "System canary protection test; preserve this record.",
          protectedRecord: true,
          systemTest: true,
          systemTestLabel: LABEL,
          systemTestStatus: liveCheckFailed ? "PROTECTED_AFTER_FAILED_CHECK" : "PROTECTED",
          canaryEvidence: { ...results, checkedAt: new Date().toISOString() },
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      } catch {
        fatalError = fatalError || "Could not confirm the canary meeting remains protected.";
        liveCheckFailed = true;
      }
    }
    if (db && recordRef) {
      try {
        const current = await recordRef.get();
        const original = recordOriginal || (current.exists ? current.data() : {});
        await recordRef.set({
          ...original,
          meetingId,
          title: TITLE,
          legalHold: true,
          legalHoldReason: "System canary protection test; preserve this record.",
          retainUntil: new Date("2099-12-31T23:59:59.000Z"),
          deletionStatus: "NOT_ELIGIBLE",
          systemTest: true,
          systemTestLabel: LABEL,
          systemTestStatus: liveCheckFailed ? "PROTECTED_AFTER_FAILED_CHECK" : "PROTECTED",
          updatedAt: new Date()
        }, { merge: true });
      } catch {
        fatalError = fatalError || "Could not confirm the canary meeting record remains protected.";
        liveCheckFailed = true;
      }
    }
  }

  if (db && meetingRef) {
    try {
      const finalMeeting = await meetingRef.get();
      results.finalMeetingExists = finalMeeting.exists;
      results.finalEnvironmentUnchanged = finalMeeting.exists && finalMeeting.get("environment") === undefined;
      if (!results.finalMeetingExists || !results.finalEnvironmentUnchanged) liveCheckFailed = true;
    } catch {
      results.finalMeetingExists = false;
      results.finalEnvironmentUnchanged = false;
      liveCheckFailed = true;
    }
  }
  if (db && recordRef) {
    try {
      const finalRecord = await recordRef.get();
      results.finalRecordExists = finalRecord.exists;
      if (!finalRecord.exists) liveCheckFailed = true;
    } catch {
      results.finalRecordExists = false;
      liveCheckFailed = true;
    }
  }

  const passed = results.missingEnvironment === true &&
    results.realMeetingDelete === true &&
    results.realMeetingPurge === true &&
    results.trialEnvironmentMutationBlocked === true &&
    results.finalMeetingExists === true &&
    results.finalEnvironmentUnchanged === true &&
    results.finalRecordExists === true &&
    !fatalError;
  if (!passed && !fatalError && !liveCheckFailed) liveCheckFailed = true;
  output("live_check_failed", liveCheckFailed ? "true" : "false");
  output("meeting_id", meetingId);
  output("record_id", recordId);
  summary([
    "## REAL meeting protection canary",
    "Meeting ID: " + meetingId,
    "Meeting-record ID: " + recordId,
    "Existing meeting reused: " + (results.reusedExistingMeeting === true ? "YES" : "NO"),
    "Existing meeting-record reused: " + (results.reusedExistingRecord === true ? "YES" : "NO"),
    "Missing environment retained: " + (results.missingEnvironment === true ? "YES" : "NO / NOT VERIFIED"),
    "REAL meeting delete refusal: " + (results.realMeetingDelete === true ? "PASS" : "FAIL / NOT VERIFIED"),
    "REAL meeting-record purge refusal: " + (results.realMeetingPurge === true ? "PASS" : "FAIL / NOT VERIFIED"),
    "Attempt to set environment to TRIAL: " + (results.trialEnvironmentMutationBlocked === true ? "BLOCKED; no TRIAL value persisted" : "FAIL / NOT VERIFIED"),
    "Final state: system-test canary retained; meeting and record marked protected/legal-hold.",
    "No cleanup or deletion was attempted after the tests."
  ]);
  if (!passed) process.exitCode = 1;
})();
