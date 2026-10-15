const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { initializeApp, getApps, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { resetAdministratorRegistration } = require("./adminRegistrationResetService.js");

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulatorHost) throw new Error("FIRESTORE_EMULATOR_HOST is required; do not run against production.");

const projectId = "demo-irpa-admin-reset-isolated";
const app = getApps().find(a => a.name === "admin-reset-isolated-test") || initializeApp({ projectId }, "admin-reset-isolated-test");
const db = getFirestore(app);
const suffix = crypto.randomUUID();
const targetUid = "reset-test-target-" + suffix;
const operationId = crypto.randomUUID();
const actor = { uid: "test-recovery-operator", email: "irpa2412@gmail.com" };

test("isolated reset touches only the target admin profile, preserves governance records, and is idempotent with intact audit", async t => {
  t.after(async () => {
    await Promise.all([
      db.collection("adminProfiles").doc(targetUid).delete(),
      db.collection("systemResetPlans").doc(operationId).delete(),
      db.collection("audit").doc("admin-registration-reset-" + operationId).delete(),
      db.collection("meetings").doc("reset-preserve-" + suffix).delete(),
      db.collection("financeTransactions").doc("reset-preserve-" + suffix).delete(),
      db.collection("signatureEnvelopes").doc("reset-preserve-" + suffix).delete(),
      db.collection("audit").doc("reset-preserve-" + suffix).delete()
    ]);
    await deleteApp(app);
  });

  await Promise.all([
    db.collection("adminProfiles").doc(targetUid).set({ active: true, email: "target@example.org" }),
    db.collection("meetings").doc("reset-preserve-" + suffix).set({ title: "Preserve this meeting" }),
    db.collection("financeTransactions").doc("reset-preserve-" + suffix).set({ amount: 123 }),
    db.collection("signatureEnvelopes").doc("reset-preserve-" + suffix).set({ status: "COMPLETED", pdfHash: "test-hash" }),
    db.collection("audit").doc("reset-preserve-" + suffix).set({ action: "PRESERVE_TEST_EVENT" })
  ]);

  const first = await resetAdministratorRegistration({ db, actor, targetUid, operationId, reason: "Isolated staging verification of administrator recovery." });
  assert.equal(first.status, "COMPLETED");
  assert.equal(first.profileReset, true);
  assert.equal((await db.collection("adminProfiles").doc(targetUid).get()).exists, false);
  assert.equal((await db.collection("meetings").doc("reset-preserve-" + suffix).get()).exists, true);
  assert.equal((await db.collection("financeTransactions").doc("reset-preserve-" + suffix).get()).exists, true);
  assert.equal((await db.collection("signatureEnvelopes").doc("reset-preserve-" + suffix).get()).exists, true);
  assert.equal((await db.collection("audit").doc("reset-preserve-" + suffix).get()).exists, true);

  const [plan, audit] = await Promise.all([
    db.collection("systemResetPlans").doc(operationId).get(),
    db.collection("audit").doc("admin-registration-reset-" + operationId).get()
  ]);
  assert.equal(plan.exists, true);
  assert.equal(audit.exists, true);
  assert.equal(plan.data().eventHash, audit.data().eventHash);
  assert.equal(plan.data().targetUid, targetUid);
  assert.equal(audit.data().scope, "adminProfiles/" + targetUid);

  const second = await resetAdministratorRegistration({ db, actor, targetUid, operationId, reason: "Isolated staging verification of administrator recovery." });
  assert.equal(second.status, "ALREADY_APPLIED");
  assert.equal(second.eventHash, first.eventHash);
  assert.equal((await db.collection("audit").where("operationId", "==", operationId).get()).size, 1);
});
