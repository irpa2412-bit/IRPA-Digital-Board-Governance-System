#!/usr/bin/env node
/**
 * READ-ONLY audit of the deployment-time members/employees UID-link migration.
 *
 * This script performs Firestore collection reads and Firebase Auth user lookups.
 * It contains no Firestore/Auth write calls and must never be used as a migration.
 * It reports aggregate counts only; no member names, emails, UIDs or document IDs.
 *
 * Run only after separate written approval, using the intended Firebase project:
 *   FIREBASE_SERVICE_ACCOUNT=... NODE_PATH=functions/node_modules \
 *     node scripts/audit-deployment-side-effects.mjs
 */
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is required; no values are printed.");
  const serviceAccount = JSON.parse(raw);
  if (serviceAccount.project_id !== "irpa-digital-board-governance") {
    throw new Error("Refusing to inspect a project other than irpa-digital-board-governance.");
  }
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });

  const db = getFirestore();
  const auth = getAuth();
  const report = {
    mode: "READ_ONLY",
    project: serviceAccount.project_id,
    collections: {},
    totals: { documentsRead: 0, authLookups: 0, uidWouldChange: 0, unchanged: 0, missingEmail: 0, authUserNotFound: 0, lookupErrors: 0 }
  };

  for (const collectionName of ["members", "employees"]) {
    const snapshot = await db.collection(collectionName).get();
    const counts = {
      documentsRead: snapshot.size,
      authLookups: 0,
      uidWouldChange: 0,
      unchanged: 0,
      missingEmail: 0,
      authUserNotFound: 0,
      lookupErrors: 0
    };
    for (const document of snapshot.docs) {
      const data = document.data() || {};
      const email = String(data.email || "").trim().toLowerCase();
      if (!email) {
        counts.missingEmail += 1;
        continue;
      }
      counts.authLookups += 1;
      try {
        const authUser = await auth.getUserByEmail(email);
        const currentUid = String(data.uid || "").trim();
        if (currentUid !== authUser.uid) counts.uidWouldChange += 1;
        else counts.unchanged += 1;
      } catch (error) {
        if (error?.code === "auth/user-not-found") counts.authUserNotFound += 1;
        else counts.lookupErrors += 1;
      }
    }
    report.collections[collectionName] = counts;
    report.totals.documentsRead += counts.documentsRead;
    for (const key of ["authLookups", "uidWouldChange", "unchanged", "missingEmail", "authUserNotFound", "lookupErrors"]) {
      report.totals[key] += counts[key];
    }
  }

  if (report.totals.lookupErrors > 0) process.exitCode = 2;
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error("Read-only migration audit failed:", error.message);
  process.exitCode = 1;
});
