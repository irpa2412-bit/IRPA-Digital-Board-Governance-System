const { onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const db = getFirestore();
const AUDIT_STATE = "mfaSecurityAudit";
const REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const APP_URL = process.env.IRPA_LOGIN_URL || "https://irpa-digital-board-governance.web.app/";

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isActiveRecord(data) {
  const status = cleanEmail(data?.status);
  const employmentStatus = cleanEmail(data?.employmentStatus);
  const registrationStatus = cleanEmail(data?.registrationStatus);
  return ["active", "activated"].includes(status) ||
    employmentStatus === "active" ||
    registrationStatus === "activated";
}

function isFullyRegistered(data) {
  if (!data || !String(data.uid || "").trim()) return false;
  if (!String(data.email || "").trim()) return false;
  if (!isActiveRecord(data)) return false;
  if (data.registrationStatus && ["pending", "submitted", "incomplete", "filtered"].includes(cleanEmail(data.registrationStatus))) return false;
  if (data.accountActivated === false) return false;
  return true;
}

function registeredIdentity(record, collection) {
  const data = record.data() || {};
  const email = cleanEmail(data.email);
  const uid = String(data.uid || "").trim();
  if (!uid || !email || !isFullyRegistered(data)) return null;
  return {
    uid,
    email,
    name: String(data.name || data.fullName || "").trim() || email.split("@")[0],
    collection,
    recordId: record.id,
    role: String(data.role || data.boardPosition || "Registered IRPA user").trim(),
    registrationStatus: data.registrationStatus || data.status || data.employmentStatus || null
  };
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function configurationLinks() {
  const app = APP_URL.replace(/\/$/, "");
  return {
    app: app + "/?security=mfa",
    firebaseMfa: "https://firebase.google.com/docs/auth/web/multi-factor",
    firebaseTotp: "https://firebase.google.com/docs/auth/web/totp-mfa"
  };
}

async function queueMfaReminder(identity, links, auditId) {
  const subject = "IRPA-DBGS Security Audit — Two-way verification required";
  const text =
`Dear ${identity.name},

The IRPA Digital Board Governance System security audit has identified that your active, fully registered IRPA account does not currently have a second verification factor configured.

For account protection, please complete the two-way verification setup using your existing IRPA registered account.

Configuration:
IRPA security setup: ${links.app}
Firebase MFA guidance: ${links.firebaseMfa}
TOTP authenticator guidance: ${links.firebaseTotp}

IMPORTANT:
- This message is sent only to the email address already registered in the IRPA Member/Employee Register.
- The security audit and OTP/recovery process do not accept a new email address as a notification destination.
- Do not send passwords, OTP codes, recovery codes, or authenticator secrets by email.

If your registered email or mobile particulars are incorrect, contact the IRPA Administrator through the official institutional process rather than changing the notification destination from this message.

Improvement of Rangeland in Pastoral Areas (IRPA)
IRPA Digital Board Governance System
Audit reference: ${auditId}`;

  const html =
`<p>Dear ${escapeHtml(identity.name)},</p>
<p>The IRPA Digital Board Governance System security audit has identified that your active, fully registered IRPA account does not currently have a second verification factor configured.</p>
<p><strong>Action required:</strong> configure two-way verification using your existing IRPA registered account.</p>
<ul>
<li><a href="${links.app}">Open IRPA security setup</a></li>
<li><a href="${links.firebaseMfa}">Firebase MFA guidance</a></li>
<li><a href="${links.firebaseTotp}">TOTP authenticator guidance</a></li>
</ul>
<p><strong>Notification-address control:</strong> this message is sent only to the email address already registered in the IRPA Member/Employee Register. The security audit and OTP/recovery process do not accept a new email address as a notification destination.</p>
<p>Do not send passwords, OTP codes, recovery codes, or authenticator secrets by email.</p>
<p>If your registered email or mobile particulars are incorrect, contact the IRPA Administrator through the official institutional process rather than changing the notification destination.</p>
<p>Improvement of Rangeland in Pastoral Areas (IRPA)<br>IRPA Digital Board Governance System<br>Audit reference: ${escapeHtml(auditId)}</p>`;

  const mailRef = await db.collection("mail").add({
    to: identity.email,
    message: { subject, text, html },
    systemGenerated: true,
    notificationType: "MFA_CONFIGURATION_AUDIT",
    registeredRecipientUid: identity.uid,
    registeredRecipientSource: identity.collection,
    registeredRecipientRecordId: identity.recordId,
    notificationAddressPolicy: "REGISTERED_RECORD_EMAIL_ONLY",
    auditReference: auditId,
    createdAt: FieldValue.serverTimestamp()
  });
  return mailRef.id;
}

async function runMfaSecurityAudit({ forceReminder = false, actorUid = "SYSTEM", actorEmail = "system" } = {}) {
  const [memberSnap, employeeSnap] = await Promise.all([
    db.collection("members").get(),
    db.collection("employees").get()
  ]);

  const identities = new Map();
  for (const record of memberSnap.docs) {
    const identity = registeredIdentity(record, "members");
    if (identity) identities.set(identity.uid, identity);
  }
  for (const record of employeeSnap.docs) {
    const identity = registeredIdentity(record, "employees");
    if (identity) {
      const existing = identities.get(identity.uid);
      identities.set(identity.uid, existing ? { ...existing, sourceCollections: [...new Set([existing.collection, "employees"])] } : identity);
    }
  }

  const links = configurationLinks();
  const summary = {
    scannedMembers: memberSnap.size,
    scannedEmployees: employeeSnap.size,
    activeFullyRegisteredIdentities: identities.size,
    mfaConfigured: 0,
    mfaMissing: 0,
    remindersQueued: 0,
    skippedEmailConflicts: 0,
    authUsersMissing: 0,
    errors: 0
  };
  const findings = [];

  for (const identity of identities.values()) {
    let authUser;
    try {
      authUser = await getAuth().getUser(identity.uid);
    } catch (error) {
      summary.authUsersMissing++;
      findings.push({ uid: identity.uid, email: identity.email, status: "AUTH_USER_NOT_FOUND", source: identity.collection });
      await db.collection("audit").add({
        action: "MFA_SECURITY_AUDIT_AUTH_USER_MISSING",
        collection: identity.collection,
        recordId: identity.recordId,
        details: { uid: identity.uid, registeredEmail: identity.email, source: "MFA_SECURITY_AUDIT" },
        actorUid, actorEmail, createdAt: FieldValue.serverTimestamp()
      });
      continue;
    }

    const authEmail = cleanEmail(authUser.email);
    if (!authEmail || authEmail !== identity.email) {
      summary.skippedEmailConflicts++;
      findings.push({ uid: identity.uid, email: identity.email, status: "REGISTERED_EMAIL_AUTH_CONFLICT", authEmail: authEmail || null });
      await db.collection("audit").add({
        action: "MFA_SECURITY_AUDIT_EMAIL_CONFLICT_BLOCKED",
        collection: identity.collection,
        recordId: identity.recordId,
        details: {
          uid: identity.uid,
          registeredEmail: identity.email,
          authEmail: authEmail || null,
          notificationAddressPolicy: "REGISTERED_RECORD_EMAIL_ONLY"
        },
        actorUid, actorEmail, createdAt: FieldValue.serverTimestamp()
      });
      continue;
    }

    const factors = authUser.multiFactor?.enrolledFactors || [];
    const configured = factors.length > 0;
    const stateRef = db.collection(AUDIT_STATE).doc(identity.uid);
    const stateSnap = await stateRef.get();
    const state = stateSnap.exists ? (stateSnap.data() || {}) : {};

    if (configured) {
      summary.mfaConfigured++;
      await stateRef.set({
        uid: identity.uid,
        registeredEmail: identity.email,
        mfaConfigured: true,
        factorCount: factors.length,
        factorIds: factors.map(f => f.factorId || "unknown"),
        lastDetectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      findings.push({ uid: identity.uid, email: identity.email, status: "MFA_CONFIGURED", factorCount: factors.length });
      continue;
    }

    summary.mfaMissing++;
    const lastReminderMs = state.lastReminderAt?.toMillis?.() || 0;
    const due = forceReminder || !lastReminderMs || (Date.now() - lastReminderMs >= REMINDER_INTERVAL_MS);
    let mailId = null;

    if (due) {
      const auditDoc = await db.collection("audit").add({
        action: "MFA_CONFIGURATION_REMINDER_PREPARED",
        collection: identity.collection,
        recordId: identity.recordId,
        details: {
          uid: identity.uid,
          registeredEmail: identity.email,
          factorCount: 0,
          notificationAddressPolicy: "REGISTERED_RECORD_EMAIL_ONLY",
          configurationLink: links.app,
          source: "AUTOMATED_MFA_SECURITY_AUDIT"
        },
        actorUid, actorEmail, createdAt: FieldValue.serverTimestamp()
      });
      mailId = await queueMfaReminder(identity, links, auditDoc.id);
      summary.remindersQueued++;
      await stateRef.set({
        uid: identity.uid,
        registeredEmail: identity.email,
        mfaConfigured: false,
        factorCount: 0,
        lastReminderAt: FieldValue.serverTimestamp(),
        lastMailId: mailId,
        lastAuditId: auditDoc.id,
        notificationAddressPolicy: "REGISTERED_RECORD_EMAIL_ONLY",
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    } else {
      await stateRef.set({
        uid: identity.uid,
        registeredEmail: identity.email,
        mfaConfigured: false,
        factorCount: 0,
        nextReminderDueAt: new Date(lastReminderMs + REMINDER_INTERVAL_MS),
        notificationAddressPolicy: "REGISTERED_RECORD_EMAIL_ONLY",
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }

    findings.push({ uid: identity.uid, email: identity.email, status: due ? "MFA_MISSING_REMINDER_QUEUED" : "MFA_MISSING_REMINDER_NOT_DUE" });
  }

  const audit = await db.collection("audit").add({
    action: "MFA_SECURITY_AUDIT_COMPLETED",
    collection: "members+employees",
    recordId: "MFA_SECURITY_AUDIT",
    details: {
      ...summary,
      notificationAddressPolicy: "REGISTERED_RECORD_EMAIL_ONLY",
      reminderIntervalDays: 7,
      configurationLinks: links,
      findingsCount: findings.length
    },
    actorUid, actorEmail, createdAt: FieldValue.serverTimestamp()
  });

  return { ok: true, auditId: audit.id, summary, findings };
}

exports.runMfaSecurityAuditScheduled = onSchedule(
  { schedule: "0 8 * * *", timeZone: "Africa/Dar_es_Salaam", region: "us-central1" },
  async () => runMfaSecurityAudit({ actorUid: "SYSTEM", actorEmail: "system" })
);

exports.runMfaSecurityAuditNow = onCall({ region: "us-central1", timeoutSeconds: 540 }, async request => {
  const uid = request.auth?.uid;
  const email = cleanEmail(request.auth?.token?.email);
  if (!uid) throw new (require("firebase-functions/v2/https").HttpsError)("unauthenticated", "Administrator authentication is required.");
  const adminSnap = await db.collection("adminProfiles").doc(uid).get();
  if (email !== "irpa2412@gmail.com" && (!adminSnap.exists || adminSnap.data()?.active !== true)) {
    throw new (require("firebase-functions/v2/https").HttpsError)("permission-denied", "Administrator authorization is required.");
  }
  return runMfaSecurityAudit({ forceReminder: request.data?.forceReminder === true, actorUid: uid, actorEmail: email });
});
