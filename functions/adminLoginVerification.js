const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const crypto = require("crypto");

const db = getFirestore();
const ADMIN_PRIMARY_EMAIL = "irpa2412@gmail.com";
const IRPA_DOMAIN = "@irpa.or.tz";
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const VERIFIED_SESSION_TTL_MS = 15 * 60 * 1000;

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isEmailVerificationAdministrator(email) {
  const normalized = cleanEmail(email);
  return normalized.endsWith(IRPA_DOMAIN) || normalized === ADMIN_PRIMARY_EMAIL;
}

function requireActiveAdministrator(request) {
  const uid = String(request.auth?.uid || "").trim();
  const email = cleanEmail(request.auth?.token?.email);
  if (!uid || !email) {
    throw new HttpsError("unauthenticated", "Administrator authentication is required.");
  }
  return { uid, email };
}

function hashCode(code, salt) {
  return crypto.createHash("sha256").update(String(salt) + ":" + String(code)).digest("hex");
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function maskedEmail(email) {
  const [local, domain] = cleanEmail(email).split("@");
  if (!local || !domain) return "your registered email";
  if (local.length <= 2) return local[0] + "•@" + domain;
  return local.slice(0, 2) + "•••@" + domain;
}

function auditDetails(request, extra = {}) {
  return {
    actorUid: request.auth?.uid || null,
    actorEmail: cleanEmail(request.auth?.token?.email),
    createdAt: FieldValue.serverTimestamp(),
    ...extra
  };
}

async function activeAdministrator(uid) {
  const snap = await db.collection("adminProfiles").doc(uid).get();
  if (!snap.exists || snap.data()?.active !== true) return null;
  return snap.data() || {};
}

exports.beginAdministratorEmailVerification = onCall({ region: "us-central1" }, async request => {
  const { uid, email } = requireActiveAdministrator(request);
  const profile = await activeAdministrator(uid);
  if (!profile) throw new HttpsError("permission-denied", "This account is not an active IRPA Administrator.");

  if (!isEmailVerificationAdministrator(email)) {
    const authUser = await getAuth().getUser(uid);
    const factors = authUser.multiFactor?.enrolledFactors || [];
    const phoneFactors = factors.filter(factor => factor.factorId === "phone");
    return {
      ok: true,
      method: "PHONE_MFA",
      phoneFactorConfigured: phoneFactors.length > 0,
      maskedPhone: phoneFactors[0]?.phoneNumber || null
    };
  }

  const challengeRef = db.collection("adminLoginVerification").doc(uid);
  const existingSnap = await challengeRef.get();
  const existing = existingSnap.exists ? existingSnap.data() || {} : {};
  const issuedMs = existing.issuedAt?.toMillis?.() || 0;
  if (issuedMs && Date.now() - issuedMs < OTP_RESEND_COOLDOWN_MS && existing.consumed !== true) {
    return {
      ok: true,
      method: "EMAIL_OTP",
      resent: false,
      maskedEmail: maskedEmail(email),
      expiresInSeconds: Math.max(1, Math.ceil((Number(existing.expiresAt?.toMillis?.() || Date.now()) - Date.now()) / 1000))
    };
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const salt = crypto.randomBytes(16).toString("hex");
  const now = Date.now();
  const expiresAt = new Date(now + OTP_TTL_MS);
  const authTime = Number(request.auth?.token?.auth_time || 0);
  if (!authTime) throw new HttpsError("failed-precondition", "The administrator authentication session has no valid authentication time.");

  const auditRef = await db.collection("audit").add({
    action: "ADMIN_LOGIN_EMAIL_OTP_ISSUED",
    collection: "adminLoginVerification",
    recordId: uid,
    details: { notificationAddressPolicy: "IRPA_DOMAIN_EMAIL", expiresAt: expiresAt.toISOString() },
    ...auditDetails(request)
  });

  await challengeRef.set({
    uid,
    email,
    method: "EMAIL_OTP",
    codeHash: hashCode(code, salt),
    salt,
    authTime,
    issuedAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(expiresAt.getTime()),
    attempts: 0,
    consumed: false,
    auditId: auditRef.id,
    updatedAt: FieldValue.serverTimestamp()
  });

  await db.collection("mail").add({
    to: email,
    message: {
      subject: "IRPA Digital Board Governance System — Administrator Login Verification Code",
      text: "Your IRPA Administrator login verification code is " + code + ". It expires in 10 minutes. If you did not initiate this login, do not use the code and notify the IRPA Administrator.",
      html: "<p>Your IRPA Administrator login verification code is:</p><p style=\"font-size:28px;font-weight:800;letter-spacing:6px\">" + code + "</p><p>This code expires in 10 minutes.</p><p>If you did not initiate this login, do not use the code and notify the IRPA Administrator.</p>"
    },
    systemGenerated: true,
    notificationType: "ADMIN_LOGIN_EMAIL_OTP",
    registeredRecipientUid: uid,
    registeredRecipientEmail: email,
    notificationAddressPolicy: "IRPA_DOMAIN_EMAIL",
    createdAt: FieldValue.serverTimestamp()
  });

  return {
    ok: true,
    method: "EMAIL_OTP",
    resent: true,
    maskedEmail: maskedEmail(email),
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000)
  };
});

exports.verifyAdministratorEmailVerification = onCall({ region: "us-central1" }, async request => {
  const { uid, email } = requireActiveAdministrator(request);
  if (!isEmailVerificationAdministrator(email)) {
    throw new HttpsError("failed-precondition", "This administrator must complete phone verification through Firebase multi-factor authentication.");
  }

  const code = String(request.data?.code || "").trim();
  if (!/^\d{6}$/.test(code)) throw new HttpsError("invalid-argument", "Enter the six-digit administrator verification code.");

  const profile = await activeAdministrator(uid);
  if (!profile) throw new HttpsError("permission-denied", "This account is not an active IRPA Administrator.");

  const ref = db.collection("adminLoginVerification").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "No active administrator verification code exists. Request a new code.");

  const challenge = snap.data() || {};
  const authTime = Number(request.auth?.token?.auth_time || 0);
  if (Number(challenge.authTime || 0) !== authTime) {
    throw new HttpsError("permission-denied", "The verification code belongs to a different login session. Start the Administrator login again.");
  }
  if (challenge.consumed === true) throw new HttpsError("failed-precondition", "This verification code has already been used.");
  if ((challenge.expiresAt?.toMillis?.() || 0) < Date.now()) {
    await ref.set({ consumed: true, consumedReason: "EXPIRED", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw new HttpsError("deadline-exceeded", "This verification code has expired. Request a new code.");
  }

  const attempts = Number(challenge.attempts || 0);
  if (attempts >= OTP_MAX_ATTEMPTS) {
    await ref.set({ consumed: true, consumedReason: "MAX_ATTEMPTS", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw new HttpsError("permission-denied", "Too many incorrect verification attempts. Request a new code.");
  }

  if (!constantTimeEqual(hashCode(code, challenge.salt), challenge.codeHash)) {
    await ref.set({ attempts: attempts + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw new HttpsError("permission-denied", "The administrator verification code is incorrect.");
  }

  const verifiedAt = Date.now();
  await ref.set({
    consumed: true,
    verifiedAt: Timestamp.fromMillis(verifiedAt),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await db.collection("audit").add({
    action: "ADMIN_LOGIN_SECOND_FACTOR_VERIFIED",
    collection: "adminLoginVerification",
    recordId: uid,
    details: { method: "EMAIL_OTP", notificationAddressPolicy: "IRPA_DOMAIN_EMAIL" },
    ...auditDetails(request)
  });

  return { ok: true, method: "EMAIL_OTP", verifiedAt, sessionTtlSeconds: VERIFIED_SESSION_TTL_MS / 1000 };
});

exports.assertAdministratorSecondFactor = onCall({ region: "us-central1" }, async request => {
  const { uid, email } = requireActiveAdministrator(request);
  const profile = await activeAdministrator(uid);
  if (!profile) throw new HttpsError("permission-denied", "This account is not an active IRPA Administrator.");

  const tokenFirebase = request.auth?.token?.firebase || {};
  if (!isEmailVerificationAdministrator(email)) {
    const secondFactor = String(tokenFirebase.sign_in_second_factor || "").trim().toLowerCase();
    if (secondFactor !== "phone") {
      throw new HttpsError("permission-denied", "Phone verification is required for non-IRPA Administrator accounts.");
    }
    return { ok: true, method: "PHONE_MFA" };
  }

  const ref = db.collection("adminLoginVerification").doc(uid);
  const snap = await ref.get();
  const challenge = snap.exists ? snap.data() || {} : {};
  const authTime = Number(request.auth?.token?.auth_time || 0);
  const verifiedMs = challenge.verifiedAt?.toMillis?.() || 0;
  if (
    challenge.consumed !== true ||
    Number(challenge.authTime || 0) !== authTime ||
    !verifiedMs ||
    Date.now() - verifiedMs > VERIFIED_SESSION_TTL_MS
  ) {
    throw new HttpsError("permission-denied", "Administrator second-factor verification is required. Return to the Administrator Gateway and complete verification.");
  }
  return { ok: true, method: "EMAIL_OTP" };
});
