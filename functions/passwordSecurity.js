const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const crypto = require("crypto");

const db = getFirestore();
const authAdmin = getAuth();

const LOCK_MS = 5 * 60 * 1000;
const FIRST_STAGE_LIMIT = 3;
const SECOND_STAGE_LIMIT = 3;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  let phone = String(value || "").trim().replace(/[\s().-]/g, "");
  if (!phone) return "";
  if (phone.startsWith("00")) phone = "+" + phone.slice(2);
  if (phone.startsWith("0")) phone = "+255" + phone.slice(1);
  if (/^255\d{9}$/.test(phone)) phone = "+" + phone;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : "";
}

function maskPhone(phone) {
  const clean = normalizePhone(phone);
  if (!clean) return "";
  return clean.length <= 6 ? "••••••" : clean.slice(0, 4) + "••••" + clean.slice(-3);
}

function securityDoc(email) {
  return db.collection("authSecurity").doc(crypto.createHash("sha256").update(normalizeEmail(email)).digest("hex"));
}

async function readState(email) {
  const snap = await securityDoc(email).get();
  const state = snap.exists ? (snap.data() || {}) : {};
  const lockUntil = Number(state.lockUntilMs || 0);
  if (lockUntil && lockUntil <= Date.now() && state.stage === "LOCKED") {
    await securityDoc(email).set({ stage: "SECOND", failedAttempts: 0, lockUntilMs: 0, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { stage: "SECOND", failedAttempts: 0, lockUntilMs: 0 };
  }
  return { stage: String(state.stage || "FIRST"), failedAttempts: Number(state.failedAttempts || 0), lockUntilMs: lockUntil, suspended: state.stage === "SUSPENDED" };
}

exports.checkPasswordAttemptState = onCall({ region: "us-central1" }, async request => {
  const email = normalizeEmail(request.data?.email);
  if (!email || !email.includes("@")) throw new HttpsError("invalid-argument", "A valid registered email address is required.");
  const state = await readState(email);
  if (state.suspended) return { allowed: false, status: "SUSPENDED", remainingAttempts: 0, resetRequired: true };
  if (state.lockUntilMs > Date.now()) {
    return { allowed: false, status: "LOCKED", remainingAttempts: 0, lockUntilMs: state.lockUntilMs, retryAfterSeconds: Math.ceil((state.lockUntilMs - Date.now()) / 1000), resetRequired: false };
  }
  const limit = state.stage === "SECOND" ? SECOND_STAGE_LIMIT : FIRST_STAGE_LIMIT;
  return { allowed: true, status: state.stage, remainingAttempts: Math.max(0, limit - state.failedAttempts), resetRequired: false };
});

exports.recordPasswordFailure = onCall({ region: "us-central1" }, async request => {
  const email = normalizeEmail(request.data?.email);
  if (!email || !email.includes("@")) throw new HttpsError("invalid-argument", "A valid registered email address is required.");
  const ref = securityDoc(email);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const current = snap.exists ? (snap.data() || {}) : {};
    if (current.stage === "SUSPENDED") return { status: "SUSPENDED", resetRequired: true, remainingAttempts: 0 };
    const lockUntil = Number(current.lockUntilMs || 0);
    if (current.stage === "LOCKED" && lockUntil > Date.now()) {
      return { status: "LOCKED", retryAfterSeconds: Math.ceil((lockUntil - Date.now()) / 1000), remainingAttempts: 0, resetRequired: false };
    }
    const stage = String(current.stage || "FIRST");
    const limit = stage === "SECOND" ? SECOND_STAGE_LIMIT : FIRST_STAGE_LIMIT;
    const failedAttempts = Number(current.failedAttempts || 0) + 1;
    if (failedAttempts < limit) {
      tx.set(ref, { stage, failedAttempts, lockUntilMs: 0, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { status: stage, remainingAttempts: limit - failedAttempts, resetRequired: false };
    }
    if (stage === "FIRST") {
      tx.set(ref, { stage: "LOCKED", failedAttempts: 0, lockUntilMs: Date.now() + LOCK_MS, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { status: "LOCKED", retryAfterSeconds: Math.ceil(LOCK_MS / 1000), remainingAttempts: 0, resetRequired: false };
    }
    tx.set(ref, { stage: "SUSPENDED", failedAttempts, lockUntilMs: 0, suspendedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { status: "SUSPENDED", remainingAttempts: 0, resetRequired: true };
  });
});

exports.clearPasswordAttemptState = onCall({ region: "us-central1" }, async request => {
  const email = normalizeEmail(request.data?.email);
  if (!email || !email.includes("@")) throw new HttpsError("invalid-argument", "A valid registered email address is required.");
  await securityDoc(email).set({ stage: "FIRST", failedAttempts: 0, lockUntilMs: 0, suspendedAt: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true };
});

exports.preparePasswordResetPhone = onCall({ region: "us-central1" }, async request => {
  const email = normalizeEmail(request.data?.email);
  if (!email || !email.includes("@")) throw new HttpsError("invalid-argument", "Enter the registered IRPA email address.");
  let user;
  try {
    user = await authAdmin.getUserByEmail(email);
  } catch (error) {
    if (error?.code === "auth/user-not-found") throw new HttpsError("not-found", "No registered IRPA account was found for that email address.");
    throw error;
  }

  const [memberSnap, employeeSnap] = await Promise.all([
    db.collection("members").where("email", "==", email).limit(5).get(),
    db.collection("employees").where("email", "==", email).limit(5).get()
  ]);
  const candidates = [];
  memberSnap.forEach(doc => candidates.push(doc.data() || {}));
  employeeSnap.forEach(doc => candidates.push(doc.data() || {}));

  const registeredPhones = [...new Set(candidates.map(record => normalizePhone(record.phone || record.mobile || record.mobileNumber || record.phoneNumber)).filter(Boolean))];
  const registeredPhone = registeredPhones[0] || "";
  if (!registeredPhone) throw new HttpsError("failed-precondition", "No valid registered mobile number is available for this IRPA account. Ask an Administrator to update the registered particulars before password recovery.");
  if (registeredPhones.length > 1) throw new HttpsError("failed-precondition", "More than one registered mobile number is associated with this account. Ask an Administrator to reconcile the registered particulars before password recovery.");

  const authPhone = normalizePhone(user.phoneNumber);
  if (authPhone && authPhone !== registeredPhone) {
    throw new HttpsError("failed-precondition", "The Firebase Authentication mobile number does not match the system-registered mobile number. Administrator reconciliation is required before password recovery.");
  }
  if (!authPhone) {
    try {
      user = await authAdmin.updateUser(user.uid, { phoneNumber: registeredPhone });
    } catch (error) {
      throw new HttpsError("failed-precondition", "The registered mobile number could not be attached to the Firebase Authentication identity. Ask an Administrator to reconcile the account.");
    }
  }

  return { ok: true, phoneNumber: registeredPhone, maskedPhone: maskPhone(registeredPhone), uid: user.uid, otpProvider: "Firebase Authentication SMS" };
});
