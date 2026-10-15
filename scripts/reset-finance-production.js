import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const EXPECTED_PROJECT_ID = "irpa-digital-board-governance";
const PRODUCTION_RESET_DOC = "wholeWebAppZeroReset20261011";
const RESET_CONTROL_DOC = "resetControl20261015";
const TRIAL_RESET_AUDIT_COLLECTION = "trialResetAudit";
const PROTECTED_TOP_LEVEL = new Set([
  "audit", "adminProfiles", "adminInvitations", "members", "employees",
  "systemSettings", "systemResetPlans", "invitations", "registrationRequests",
  "inductionRecords", "memberCounters", "employeeCounters", "auditorProfiles",
  "signerIdentities", "signatureProfiles", "signatureEnvelopes", "signatureEvents",
  "notifications", "mail", "financialReferenceCounters"
]);
const ACTUAL_ONLY_COLLECTIONS = [
  "adminProfiles", "members", "employees", "auditorProfiles",
  "signerIdentities", "signatureProfiles", "systemSettings"
];

function readMode() {
  const mode = String(process.env.RESET_MODE || "");
  if (mode !== "PRODUCTION_ONCE" && mode !== "TRIAL_ADMIN") {
    throw new Error("RESET_MODE must be PRODUCTION_ONCE or TRIAL_ADMIN.");
  }
  return mode;
}

async function deleteCollectionTree(collectionRef, report) {
  const snap = await collectionRef.get();
  report.before[collectionRef.path] = snap.size;
  let deleted = 0;
  for (const doc of snap.docs) {
    for (const child of await doc.ref.listCollections()) {
      deleted += await deleteCollectionTree(child, report);
    }
    await doc.ref.delete();
    deleted++;
  }
  report.deleted[collectionRef.path] = deleted;
  const verify = await collectionRef.get();
  report.after[collectionRef.path] = verify.size;
  if (!verify.empty) throw new Error(`Verification failed for ${collectionRef.path}: ${verify.size} documents remain.`);
  return deleted;
}

async function writeActualDataGateManifest(db) {
  const collections = {};
  for (const name of ACTUAL_ONLY_COLLECTIONS) {
    const snap = await db.collection(name).get();
    collections[name] = { documentCount: snap.size, environment: "ACTUAL" };
  }
  const manifest = {
    status: "VERIFIED", environment: "ACTUAL",
    migrationType: "identity-and-system-configuration-routing",
    scope: "Registered identity and system configuration are preserved by resets.",
    collections, verifiedAt: FieldValue.serverTimestamp()
  };
  await db.collection("systemSettings").doc("actualDataGateMigration20261011").set(manifest, { merge: true });
  return manifest;
}

function readActor() {
  const actor = String(process.env.RESET_ACTOR || "").trim();
  if (actor.length < 3 || actor.length > 200) {
    throw new Error("RESET_ACTOR must identify the authorized administrator or approved production operator.");
  }
  return actor;
}

async function main() {
  const mode = readMode();
  const actor = readActor();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT secret is missing.");
  const serviceAccount = JSON.parse(raw);
  if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
    throw new Error(`Refusing reset: expected project ${EXPECTED_PROJECT_ID}, received ${serviceAccount.project_id || "unknown"}.`);
  }
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount), projectId: EXPECTED_PROJECT_ID });
  const db = getFirestore();
  const controlRef = db.collection("systemSettings").doc(RESET_CONTROL_DOC);
  const productionAuditRef = db.collection("systemSettings").doc(PRODUCTION_RESET_DOC);
  const controlSnap = await controlRef.get();
  const control = controlSnap.exists ? controlSnap.data() : {};

  if (mode === "PRODUCTION_ONCE") {
    // Production reset capability is a single-use, server-side latch. It is never
    // recreated automatically after consumption and cannot be re-enabled by this workflow.
    if (control.productionResetConsumed === true || (await productionAuditRef.get()).data()?.status === "COMPLETED") {
      throw new Error("PRODUCTION_RESET_ALREADY_CONSUMED: production reset is permanently locked.");
    }
    if (process.env.PRODUCTION_RESET_AUTHORIZED !== "YES_I_AUTHORIZE_ONE_TIME_PRODUCTION_RESET") {
      throw new Error("Production reset requires the exact authorization input.");
    }
    // Write the irreversible latch before deletion so a partial failure cannot make
    // this single-use capability reusable; a failed attempt requires manual forensic recovery.
    await controlRef.set({
      ...control,
      productionResetConsumed: true,
      productionResetConsumedAt: FieldValue.serverTimestamp(),
      productionResetConsumedBy: actor,
      productionResetState: "CONSUMED_IN_PROGRESS",
      productionResetVersion: 1
    }, { merge: true });
    // Close actual operational data entry before the first deletion. systemSettings
    // is protected from the reset, so this closed state survives the cleanup.
    const actualGateRef = db.collection("systemSettings").doc("actualDataAccess");
    const actualGateSnap = await actualGateRef.get();
    const actualGate = actualGateSnap.exists ? (actualGateSnap.data() || {}) : {};
    await actualGateRef.set({
      enabled: false,
      status: "CLOSED",
      changedAt: FieldValue.serverTimestamp(),
      changedBy: actor,
      closeReason: "One-time pre-production reset; remain closed until final system tests pass.",
      finalTestsAttested: false,
      version: Number(actualGate.version || 0) + 1
    }, { merge: true });
  } else {
    // Trial reset follows the application's established record markers across the
    // resettable operational collections. Identity records and protected collections
    // are excluded from the scan and cannot be deleted by this path.
    if (process.env.TRIAL_RESET_AUTHORIZED !== "YES_I_AUTHORIZE_TRIAL_DATA_RESET") {
      throw new Error("Trial reset requires the exact authorization input.");
    }
  }

  const report = {
    status: "STARTED", mode, projectId: EXPECTED_PROJECT_ID, actor,
    startedAt: new Date().toISOString(), before: {}, deleted: {}, after: {}
  };
  let totalDeleted = 0;

  if (mode === "PRODUCTION_ONCE") {
    const collections = await db.listCollections();
    const targets = collections.filter(c => !PROTECTED_TOP_LEVEL.has(c.id));
    report.protected = {};
    for (const c of collections) {
      if (PROTECTED_TOP_LEVEL.has(c.id)) report.protected[c.id] = { documentsPreserved: (await c.get()).size };
    }
    for (const collection of targets) totalDeleted += await deleteCollectionTree(collection, report);
    const remaining = {};
    for (const collection of targets) {
      const snap = await collection.get();
      remaining[collection.id] = snap.size;
      if (!snap.empty) throw new Error(`Top-level verification failed for ${collection.id}.`);
    }
    report.remainingTopLevelCounts = remaining;
    report.scope = "One-time removal of preliminary application data across all non-protected top-level collections and nested subcollections.";
    report.protectedTopLevelCollections = [...PROTECTED_TOP_LEVEL];
    report.totalDeletedDocuments = totalDeleted;
    report.completedAt = FieldValue.serverTimestamp();
    report.status = "COMPLETED";
    await productionAuditRef.create(report);
    await controlRef.set({
      productionResetState: "CONSUMED_COMPLETED",
      productionResetCompletedAt: FieldValue.serverTimestamp(),
      productionResetDeletedCount: totalDeleted
    }, { merge: true });
    console.log("WHOLE_WEB_APP_PRODUCTION_RESET_COMPLETED_AND_LATCHED");
    console.log(JSON.stringify({ ...report, completedAt: "serverTimestamp", actor }, null, 2));
  } else {
    // Match the same marker semantics as the app's reset protocol. Keep the scan
    // within operational collections; identity, configuration, invitation, audit,
    // and signer/security collections are never targets.
    const resettable = [
      "meetings","meetingSubscriptions","meetingRoomEvents","transcriptions",
      "resolutions","votes","voteCorrections","votingIssues","actions","documents","signatures","decisions",
      "risks","reports","authorizationRequests","workflowActions","staffPaymentRequests","financeBudgets",
      "financeTransactions","financeFunding","financeApprovals","financeCommitments","financeGrants",
      "financeBankAccounts","financeReconciliations","financeAssets","financeRisks","financeReports",
      "financeChartOfAccounts","financeJournalBatches","financePeriods","financeLedgerJournals",
      "financeLedgerEntries","financePaymentMatches","financePaymentTrace","financeReferenceRegistry",
      "procurementVendors","procurementRequests","procurementVendorScores","procurementVendorBlacklist",
      "procurementVendorProbation","donorFunders","grantReportingObligations","participants"
    ];
    const isTrial = data =>
      String(data?.recordOrigin || "").trim().toUpperCase() === "TRIAL" ||
      data?.trialData === true || data?.isTrial === true;
    for (const name of resettable) {
      const ref = db.collection(name);
      let cursor = null, before = 0, deleted = 0, after = -1;
      while (true) {
        let q = ref.orderBy("__name__").limit(400);
        if (cursor) q = q.startAfter(cursor);
        const snap = await q.get();
        before += snap.size;
        if (snap.empty) { after = 0; break; }
        const batch = db.batch();
        let batchDeletes = 0;
        for (const doc of snap.docs) {
          if (isTrial(doc.data())) {
            batch.delete(doc.ref);
            batchDeletes++;
          }
        }
        if (batchDeletes) await batch.commit();
        deleted += batchDeletes;
        cursor = snap.docs[snap.docs.length - 1];
        if (snap.size < 400) { after = 0; break; }
      }
      const verify = await ref.orderBy("__name__").limit(400).get();
      const remainingTrial = verify.docs.filter(doc => isTrial(doc.data()));
      if (remainingTrial.length) throw new Error(`Trial reset verification failed for ${name}: trial-marked records remain in the first verification page.`);
      report.before[name] = before;
      report.deleted[name] = deleted;
      report.after[name] = "verified-no-trial-marked-records";
      totalDeleted += deleted;
    }
    report.scope = "Delete only documents explicitly marked recordOrigin=TRIAL, trialData=true, or isTrial=true across approved operational collections. Registered identities, security records, and unmarked/production records are preserved.";
    report.totalDeletedDocuments = totalDeleted;
    report.status = "COMPLETED";
    report.completedAt = FieldValue.serverTimestamp();
    const audit = await db.collection(TRIAL_RESET_AUDIT_COLLECTION).add(report);
    await writeActualDataGateManifest(db);
    console.log("ADMIN_TRIAL_DATA_RESET_VERIFIED");
    console.log(JSON.stringify({ ...report, auditId: audit.id, completedAt: "serverTimestamp", actor }, null, 2));
  }
}

main().catch(error => {
  console.error("RESET_FAILED", error);
  process.exit(1);
});
