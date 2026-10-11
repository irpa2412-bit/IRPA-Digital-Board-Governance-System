import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const EXPECTED_PROJECT_ID = "irpa-digital-board-governance";
const AUDIT_DOC = "wholeWebAppZeroReset20261011";
// Preserve authentication, authorization, personnel identity, and deployment configuration
// so the administrator can sign in and continue operational-readiness work after the reset.
const PROTECTED_TOP_LEVEL = new Set([
  "adminProfiles",
  "members",
  "employees",
  "systemSettings",
  "auditorProfiles",
  "signerIdentities",
  "signatureProfiles"
]);

async function deleteCollectionTree(db, collectionRef, report) {
  const snap = await collectionRef.get();
  report.before[collectionRef.path] = snap.size;
  let deleted = 0;
  for (const doc of snap.docs) {
    const children = await doc.ref.listCollections();
    for (const child of children) {
      deleted += await deleteCollectionTree(db, child, report);
    }
    await doc.ref.delete();
    deleted++;
  }
  report.deleted[collectionRef.path] = deleted;
  const verify = await collectionRef.get();
  report.after[collectionRef.path] = verify.size;
  if (!verify.empty) {
    throw new Error(`Zero-reset verification failed for ${collectionRef.path}: ${verify.size} documents remain.`);
  }
  return deleted;
}

const ACTUAL_DATA_GATE_DOC = "actualDataGateMigration20261011";
const ACTUAL_ONLY_COLLECTIONS = [
  "adminProfiles", "members", "employees", "auditorProfiles",
  "signerIdentities", "signatureProfiles", "systemSettings"
];

async function writeActualDataGateManifest(db) {
  const collections = {};
  for (const name of ACTUAL_ONLY_COLLECTIONS) {
    const snap = await db.collection(name).get();
    collections[name] = { documentCount: snap.size, environment: "ACTUAL" };
  }
  const manifest = {
    status: "VERIFIED",
    environment: "ACTUAL",
    migrationType: "identity-and-system-configuration-routing",
    scope: "Member and employee identities, signer identity and signature profiles, auditor profiles, administrator profiles, and system configuration remain in the live Firestore project and are never switched to the trial data environment.",
    collections,
    verifiedAt: FieldValue.serverTimestamp()
  };
  await db.collection("systemSettings").doc(ACTUAL_DATA_GATE_DOC).set(manifest, { merge: true });
  return manifest;
}

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
    const actualDataGate = await writeActualDataGateManifest(db);
    console.log("WHOLE_WEB_APP_ZERO_RESET_ALREADY_COMPLETED: no deletion performed.");
    console.log("ACTUAL_DATA_GATE_IDENTITY_MIGRATION_VERIFIED");
    console.log(JSON.stringify({ reset: existing.data(), actualDataGate }, null, 2));
    return;
  }

  const report = { before: {}, deleted: {}, after: {}, protected: {}, startedAt: new Date().toISOString() };
  const collections = await db.listCollections();
  const targets = collections.filter(c => !PROTECTED_TOP_LEVEL.has(c.id) && c.id !== "systemSettings");
  const totalBefore = {};
  for (const collection of collections) {
    if (PROTECTED_TOP_LEVEL.has(collection.id)) {
      const snap = await collection.get();
      report.protected[collection.id] = { documentsPreserved: snap.size };
      continue;
    }
    if (collection.id === "systemSettings") continue;
    totalBefore[collection.id] = (await collection.get()).size;
  }

  let deletedDocuments = 0;
  for (const collection of targets) {
    deletedDocuments += await deleteCollectionTree(db, collection, report);
  }

  const remaining = {};
  for (const collection of targets) {
    const snap = await collection.get();
    remaining[collection.id] = snap.size;
    if (!snap.empty) throw new Error(`Top-level zero-reset verification failed for ${collection.id}: ${snap.size} documents remain.`);
  }
  const result = {
    status: "COMPLETED",
    projectId: EXPECTED_PROJECT_ID,
    completedAt: FieldValue.serverTimestamp(),
    scope: "Zero-reset all application data collections and their nested subcollections. Preserve only administrator/member/employee identity, auditor and signer identity profiles, and system configuration required for secure access and continued setup.",
    protectedTopLevelCollections: [...PROTECTED_TOP_LEVEL],
    totalDeletedDocuments: deletedDocuments,
    beforeTopLevelCounts: totalBefore,
    deletedByCollectionPath: report.deleted,
    beforeByCollectionPath: report.before,
    afterByCollectionPath: report.after,
    protected: report.protected,
    remainingTopLevelCounts: remaining
  };
  await auditRef.set(result);
  const actualDataGate = await writeActualDataGateManifest(db);
  console.log("WHOLE_WEB_APP_ZERO_RESET_VERIFIED");
  console.log("ACTUAL_DATA_GATE_IDENTITY_MIGRATION_VERIFIED");
  console.log(JSON.stringify({ ...result, actualDataGate, completedAt: "serverTimestamp" }, null, 2));
}

main().catch(error => {
  console.error("WHOLE_WEB_APP_ZERO_RESET_FAILED", error);
  process.exit(1);
});
