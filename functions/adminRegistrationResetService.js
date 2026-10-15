const crypto = require("node:crypto");
const { FieldValue } = require("firebase-admin/firestore");

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function resetAdministratorRegistration({ db, actor, targetUid, operationId, reason }) {
  if (!db || !actor?.uid || !actor?.email || !targetUid || !operationId || !reason) {
    const error = new Error("Validated reset inputs are required.");
    error.code = "invalid-argument";
    throw error;
  }

  const planRef = db.collection("systemResetPlans").doc(operationId);
  const targetRef = db.collection("adminProfiles").doc(targetUid);
  const auditRef = db.collection("audit").doc("admin-registration-reset-" + operationId);
  const outcome = await db.runTransaction(async tx => {
    const [planSnap, targetSnap, auditSnap] = await Promise.all([
      tx.get(planRef), tx.get(targetRef), tx.get(auditRef)
    ]);

    if (planSnap.exists) {
      const prior = planSnap.data() || {};
      if (prior.operation !== "ADMIN_REGISTRATION_RESET" || prior.targetUid !== targetUid) {
        const error = new Error("Operation ID has already been used for a different operation.");
        error.code = "already-exists";
        throw error;
      }
      if (!auditSnap.exists || prior.auditRecordId !== auditRef.id || auditSnap.data()?.eventHash !== prior.eventHash) {
        const error = new Error("Existing reset plan failed audit-integrity verification.");
        error.code = "failed-precondition";
        throw error;
      }
      return { ok: true, operationId, status: "ALREADY_APPLIED", targetUid, profileReset: prior.profileReset === true, eventHash: prior.eventHash };
    }

    if (auditSnap.exists) {
      const error = new Error("An audit record exists without its reset plan; refusing to continue.");
      error.code = "failed-precondition";
      throw error;
    }

    const profileReset = targetSnap.exists;
    const event = {
      operation: "ADMIN_REGISTRATION_RESET",
      operationId,
      targetUid,
      actorUid: actor.uid,
      actorEmail: actor.email,
      reason,
      profileReset,
      scope: "adminProfiles/" + targetUid,
      preservedCollections: ["members", "employees", "meetings", "meetingSubscriptions", "resolutions", "votes", "documents", "signatures", "signatureEnvelopes", "signatureEvents", "signerIdentities", "audit", "financeTransactions", "financeBudgets", "financeReports", "financeLedgerEntries"]
    };
    const eventHash = stableHash(event);
    const createdAt = FieldValue.serverTimestamp();

    if (profileReset) tx.delete(targetRef);
    tx.create(auditRef, {
      ...event,
      action: "ADMIN_REGISTRATION_RESET",
      collection: "adminProfiles",
      recordId: targetUid,
      eventHash,
      createdAt
    });
    tx.create(planRef, {
      ...event,
      status: "COMPLETED",
      auditRecordId: auditRef.id,
      eventHash,
      requestedAt: createdAt,
      completedAt: createdAt
    });
    return { ok: true, operationId, status: "COMPLETED", targetUid, profileReset, eventHash };
  });

  return outcome;
}

module.exports = { resetAdministratorRegistration, stableHash };
