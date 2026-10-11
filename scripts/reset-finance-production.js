import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const EXPECTED_PROJECT_ID = "irpa-digital-board-governance";
const AUDIT_DOC = "financeProductionReset20261011";
const PROTECTED_REGISTERS = new Set([
  "financeChartOfAccounts",
  "financePeriods",
  "financeReferenceRegistry"
]);
const TARGET_COLLECTIONS = [
  "financeJournalBatches",
  "financeLedgerJournals",
  "financeLedgerEntries",
  "financePaymentMatches",
  "financeBudgets",
  "financeTransactions",
  "financePaymentTrace",
  "financeFunding",
  "financeApprovals",
  "financeCommitments",
  "financeGrants",
  "financeBankAccounts",
  "financeReconciliations",
  "financeAssets",
  "financeRisks",
  "financeReports"
];

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT secret is missing.");
  const serviceAccount = JSON.parse(raw);
  if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
    throw new Error(`Refusing reset: expected project ${EXPECTED_PROJECT_ID}, received ${serviceAccount.project_id || "unknown"}.`);
  }
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount), projectId: EXPECTED_PROJECT_ID });
  const db = getFirestore();
  const auditRef = db.collection("systemSettings").doc(AUDIT_DOC);
  const existing = await auditRef.get();
  if (existing.exists && existing.data()?.status === "COMPLETED") {
    console.log("FINANCE_RESET_ALREADY_COMPLETED: no deletion performed.");
    console.log(JSON.stringify(existing.data()));
    return;
  }

  const before = {};
  const deleted = {};
  const trialPreserved = {};
  const after = {};
  for (const name of TARGET_COLLECTIONS) {
    const snap = await db.collection(name).get();
    before[name] = snap.size;
    const productionDocs = snap.docs.filter(doc => doc.data()?.recordOrigin !== "TRIAL");
    const trialDocs = snap.docs.filter(doc => doc.data()?.recordOrigin === "TRIAL");
    trialPreserved[name] = trialDocs.length;
    const writer = db.bulkWriter();
    let count = 0;
    for (const doc of productionDocs) {
      writer.delete(doc.ref);
      count++;
    }
    await writer.close();
    deleted[name] = count;
  }

  for (const name of TARGET_COLLECTIONS) {
    const snap = await db.collection(name).get();
    after[name] = snap.size;
    const remainingProduction = snap.docs.filter(doc => doc.data()?.recordOrigin !== "TRIAL").length;
    const remainingTrial = snap.docs.filter(doc => doc.data()?.recordOrigin === "TRIAL").length;
    if (remainingProduction !== 0) {
      throw new Error(`Verification failed for ${name}: ${remainingProduction} non-TRIAL record(s) remain.`);
    }
    if (remainingTrial !== trialPreserved[name]) {
      throw new Error(`TRIAL preservation check failed for ${name}: expected ${trialPreserved[name]}, found ${remainingTrial}.`);
    }
  }

  const preservedRegisters = {};
  for (const name of PROTECTED_REGISTERS) {
    preservedRegisters[name] = (await db.collection(name).get()).size;
  }
  const result = {
    status: "COMPLETED",
    projectId: EXPECTED_PROJECT_ID,
    completedAt: FieldValue.serverTimestamp(),
    scope: "Delete all non-TRIAL documents in operational Finance collections; preserve all TRIAL documents and protected registers.",
    protectedRegisters: [...PROTECTED_REGISTERS],
    targetCollections: TARGET_COLLECTIONS,
    before,
    deleted,
    trialPreserved,
    after,
    preservedRegisters
  };
  await auditRef.set(result);
  console.log("FINANCE_PRODUCTION_RESET_VERIFIED");
  console.log(JSON.stringify({ ...result, completedAt: "serverTimestamp" }, null, 2));
}

main().catch(error => {
  console.error("FINANCE_PRODUCTION_RESET_FAILED", error);
  process.exit(1);
});
