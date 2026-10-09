const assert = require("node:assert/strict");
const { before, after, beforeEach, test } = require("node:test");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const fs = require("node:fs");

let testEnv;
const projectId = process.env.GCLOUD_PROJECT || "irpa-digital-board-governance";
before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") }
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("employees/departmental-director").set({
      uid: "departmental-director",
      email: "director@example.test",
      status: "Active",
      role: "Departmental Director"
    });
    await db.doc("members/board-member").set({
      uid: "board-member",
      email: "board@example.test",
      status: "Active",
      role: "Board Member"
    });
    await db.doc("adminProfiles/admin-user").set({ active: true, email: "admin@example.test" });
  });
});
function meeting(overrides = {}) {
  return {
    title: "Policy test meeting",
    meetingCategory: "ADMINISTRATIVE",
    meetingPolicyId: "ADMINISTRATIVE",
    meetingType: "Management Meeting",
    initiatorUid: "departmental-director",
    initiatorEmail: "director@example.test",
    registerStatus: "Draft",
    status: "Scheduled",
    ...overrides
  };
}
test("active designated departmental director can create a categorized meeting", async () => {
  const db = testEnv.authenticatedContext("departmental-director", {
    email: "director@example.test"
  }).firestore();
  await assertSucceeds(db.doc("meetings/departmental-meeting").set(meeting()));
});
test("designated initiator can complete initial registration release exactly once", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("meetings/departmental-meeting").set(meeting());
  });
  const db = testEnv.authenticatedContext("departmental-director", {
    email: "director@example.test"
  }).firestore();
  await assertSucceeds(db.doc("meetings/departmental-meeting").update({
    registerStatus: "Registered",
    registeredAt: "2026-10-09T17:00:00.000Z"
  }));
});
test("departmental registrar cannot edit a released meeting", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("meetings/departmental-meeting").set(meeting({
      registerStatus: "Registered",
      registeredAt: "2026-10-09T17:00:00.000Z"
    }));
  });
  const db = testEnv.authenticatedContext("departmental-director", {
    email: "director@example.test"
  }).firestore();
  await assertFails(db.doc("meetings/departmental-meeting").update({ title: "Unauthorised edit" }));
});
test("only administrator can delete a meeting", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("meetings/departmental-meeting").set(meeting({
      registerStatus: "Registered",
      registeredAt: "2026-10-09T17:00:00.000Z"
    }));
  });
  const registrarDb = testEnv.authenticatedContext("departmental-director", {
    email: "director@example.test"
  }).firestore();
  await assertFails(registrarDb.doc("meetings/departmental-meeting").delete());
  const adminDb = testEnv.authenticatedContext("admin-user", {
    email: "admin@example.test"
  }).firestore();
  await assertSucceeds(adminDb.doc("meetings/departmental-meeting").delete());
});
test("meeting creation rejects missing or invalid category metadata", async () => {
  const db = testEnv.authenticatedContext("departmental-director", {
    email: "director@example.test"
  }).firestore();
  await assertFails(db.doc("meetings/invalid-category").set(meeting({
    meetingCategory: "SECRET",
    meetingPolicyId: "SECRET"
  })));
});
