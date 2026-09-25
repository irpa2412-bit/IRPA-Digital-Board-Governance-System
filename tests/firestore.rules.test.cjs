const assert = require("node:assert/strict");
const { before, after, beforeEach, test } = require("node:test");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} = require("@firebase/rules-unit-testing");

let testEnv;
const projectId = process.env.GCLOUD_PROJECT || "irpa-digital-board-governance";

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: require("node:fs").readFileSync("firestore.rules", "utf8") }
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("adminProfiles/admin-user").set({ active: true, email: "admin@example.test" });
    await db.doc("members/member-user").set({
      uid: "member-user",
      email: "member@example.test",
      status: "Active",
      role: "Board Member"
    });
    await db.doc("members/finance-user").set({
      uid: "finance-user",
      email: "finance@example.test",
      status: "Active",
      role: "Finance Manager"
    });
    await db.doc("adminProfiles/other-user").set({ active: false });
    await db.doc("financeTransactions/tx-1").set({
      title: "Controlled transaction",
      status: "Approved",
      amount: 1000,
      currency: "TZS",
      referenceNumber: "IRPA-FIN-2026-00001"
    });
    await db.doc("audit/audit-1").set({
      action: "TEST",
      actorUid: "admin-user"
    });
  });
});

test("unauthenticated users cannot read finance transactions", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(db.doc("financeTransactions/tx-1").get());
});

test("ordinary governance members cannot read finance transactions", async () => {
  const db = testEnv.authenticatedContext("member-user", {
    email: "member@example.test"
  }).firestore();
  await assertFails(db.doc("financeTransactions/tx-1").get());
});

test("server-controlled finance role can read finance transactions", async () => {
  const db = testEnv.authenticatedContext("finance-user", {
    email: "finance@example.test",
    irpaRoles: ["Finance Manager"]
  }).firestore();
  await assertSucceeds(db.doc("financeTransactions/tx-1").get());
});

test("finance role cannot overwrite a generated financial reference", async () => {
  const db = testEnv.authenticatedContext("finance-user", {
    email: "finance@example.test",
    irpaRoles: ["Finance Manager"]
  }).firestore();
  await assertFails(db.doc("financeTransactions/tx-1").update({
    referenceNumber: "IRPA-FIN-2026-99999"
  }));
});

test("inactive administrator profile does not grant administrator access", async () => {
  const db = testEnv.authenticatedContext("other-user", {
    email: "other@example.test"
  }).firestore();
  await assertFails(db.doc("adminProfiles/admin-user").get());
});

test("authenticated users may append audit records but cannot modify them", async () => {
  const db = testEnv.authenticatedContext("member-user", {
    email: "member@example.test"
  }).firestore();
  await assertSucceeds(db.doc("audit/audit-new").set({
    action: "TEST_APPEND",
    actorUid: "member-user"
  }));
  await assertFails(db.doc("audit/audit-1").update({ action: "TAMPERED" }));
});

test("active finance role can create a finance transaction without client-supplied reference", async () => {
  const db = testEnv.authenticatedContext("finance-user", {
    email: "finance@example.test",
    irpaRoles: ["Finance Manager"]
  }).firestore();
  await assertSucceeds(db.doc("financeTransactions/tx-new").set({
    title: "New transaction",
    status: "Draft",
    amount: 500,
    currency: "TZS"
  }));
});
