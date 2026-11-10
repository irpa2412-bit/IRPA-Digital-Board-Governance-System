const assert = require("node:assert/strict");
const { before, after, beforeEach, test } = require("node:test");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, writeBatch, serverTimestamp, getDoc, setDoc } = require("firebase/firestore");
const fs = require("node:fs");

let env;
const projectId = "demo-irpa-social-restore";

function archivedRecord(overrides = {}) {
  return {
    platform: "Facebook",
    accountName: "IRPA official Facebook Page — acceptance record",
    handle: "irpa.example",
    profileUrl: "https://facebook.com/irpa.example",
    accountType: "Organization page",
    owner: "IRPA",
    custodian: "Communications team",
    purpose: "Official communications",
    audience: "Public",
    authorizationReference: "",
    reviewDate: "",
    notes: "",
    connectionStatus: "Archived",
    createdByUid: "creator",
    createdByEmail: "creator@example.test",
    createdAt: new Date("2026-11-01T00:00:00Z"),
    updatedByUid: "creator",
    updatedAt: new Date("2026-11-01T00:00:00Z"),
    recordOrigin: "PRODUCTION",
    ...overrides
  };
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") }
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("socialMediaAccounts/archived-with-status").set(
      archivedRecord({ previousConnectionStatus: "Suspended" })
    );
    await context.firestore().doc("socialMediaAccounts/legacy-archived").set(archivedRecord());
    await context.firestore().doc("socialMediaAccounts/archived-active").set(archivedRecord({ previousConnectionStatus: "Active" }));
    await context.firestore().doc("socialMediaAccounts/to-be-archived").set(archivedRecord({ connectionStatus: "Suspended" }));
  });
});

function restoreBatch(db, id, status, reason) {
  const batch = writeBatch(db);
  batch.update(doc(db, "socialMediaAccounts", id), {
    connectionStatus: status,
    restoredAt: serverTimestamp(),
    restoredBy: "reviewer",
    restoreReason: reason
  });
  batch.set(doc(db, "socialMediaAccountsAudit", "restore-" + id), {
    recordId: id,
    platform: "Facebook",
    accountName: "IRPA official Facebook Page — acceptance record",
    action: "STATUS_RESTORED",
    actorUid: "reviewer",
    actorEmail: "reviewer@example.test",
    reason,
    createdAt: serverTimestamp(),
    recordOrigin: "PRODUCTION"
  });
  return batch.commit();
}

test("archiving records the status that must be restored later", async () => {
  const db = env.authenticatedContext("reviewer", {
    email: "reviewer@example.test", admin: true
  }).firestore();
  const batch = writeBatch(db);
  batch.update(doc(db, "socialMediaAccounts/to-be-archived"), {
    connectionStatus: "Archived",
    previousConnectionStatus: "Suspended",
    updatedByUid: "reviewer",
    updatedAt: serverTimestamp()
  });
  batch.set(doc(db, "socialMediaAccountsAudit", "archive-status-test"), {
    recordId: "to-be-archived",
    platform: "Facebook",
    accountName: "IRPA official Facebook Page — acceptance record",
    action: "STATUS_ARCHIVED",
    actorUid: "reviewer",
    actorEmail: "reviewer@example.test",
    createdAt: serverTimestamp(),
    recordOrigin: "PRODUCTION"
  });
  await assertSucceeds(batch.commit());
  const snapshot = await getDoc(doc(db, "socialMediaAccounts", "to-be-archived"));
  assert.equal(snapshot.data().previousConnectionStatus, "Suspended");
});

test("reviewer restores to the stored previous status and appends a reasoned audit event", async () => {
  const db = env.authenticatedContext("reviewer", {
    email: "reviewer@example.test", admin: true
  }).firestore();
  await assertSucceeds(restoreBatch(db, "archived-with-status", "Suspended", "Registration was only partially completed; review before activation."));
  const snapshot = await getDoc(doc(db, "socialMediaAccounts", "archived-with-status"));
  assert.equal(snapshot.data().connectionStatus, "Suspended");
  assert.equal(snapshot.data().restoredBy, "reviewer");
  assert.equal(snapshot.data().restoreReason, "Registration was only partially completed; review before activation.");
  assert.ok(snapshot.data().restoredAt);
  assert.equal(snapshot.data().previousConnectionStatus, "Suspended");
});

test("restoring an account previously Active returns it to Pending Verification", async () => {
  const db = env.authenticatedContext("reviewer", {
    email: "reviewer@example.test", admin: true
  }).firestore();
  await assertSucceeds(restoreBatch(db, "archived-active", "Pending Verification", "Reverification is required before activation."));
  const snapshot = await getDoc(doc(db, "socialMediaAccounts", "archived-active"));
  assert.equal(snapshot.data().connectionStatus, "Pending Verification");
  assert.equal(snapshot.data().restoredBy, "reviewer");
  assert.equal(snapshot.data().restoreReason, "Reverification is required before activation.");
});

test("restoration cannot return a previously Active account directly to Active", async () => {
  const db = env.authenticatedContext("reviewer", {
    email: "reviewer@example.test", admin: true
  }).firestore();
  await assertFails(restoreBatch(db, "archived-active", "Active", "Do not automatically reactivate."));
});

test("audit reason, when present on any audit action, must be a string of 1 to 500 characters", async () => {
  const db = env.authenticatedContext("reviewer", {
    email: "reviewer@example.test", admin: true
  }).firestore();
  for (const [index, reason] of ["", 42, "x".repeat(501)].entries()) {
    const batch = writeBatch(db);
    batch.update(doc(db, "socialMediaAccounts", "to-be-archived"), {
      connectionStatus: "Archived",
      previousConnectionStatus: "Suspended",
      updatedByUid: "reviewer",
      updatedAt: serverTimestamp()
    });
    batch.set(doc(db, "socialMediaAccountsAudit", "invalid-audit-reason-" + index), {
      recordId: "to-be-archived",
      platform: "Facebook",
      accountName: "IRPA official Facebook Page — acceptance record",
      action: "STATUS_ARCHIVED",
      actorUid: "reviewer",
      actorEmail: "reviewer@example.test",
      reason,
      createdAt: serverTimestamp(),
      recordOrigin: "PRODUCTION"
    });
    await assertFails(batch.commit());
  }
});

test("reviewer cannot append STATUS_RESTORED without restoring the account in the same batch", async () => {
  const db = env.authenticatedContext("reviewer", {
    email: "reviewer@example.test", admin: true
  }).firestore();
  const audit = doc(db, "socialMediaAccountsAudit", "standalone-reviewer-restore");
  await assertFails(setDoc(audit, {
    recordId: "archived-with-status",
    platform: "Facebook",
    accountName: "IRPA official Facebook Page — acceptance record",
    action: "STATUS_RESTORED",
    actorUid: "reviewer",
    actorEmail: "reviewer@example.test",
    reason: "Attempted standalone restoration audit.",
    createdAt: serverTimestamp(),
    recordOrigin: "PRODUCTION"
  }));
});

test("restoration audit reason must exactly match the same-batch account restoration", async () => {
  const db = env.authenticatedContext("reviewer", {
    email: "reviewer@example.test", admin: true
  }).firestore();
  const batch = writeBatch(db);
  batch.update(doc(db, "socialMediaAccounts", "archived-with-status"), {
    connectionStatus: "Suspended",
    restoredAt: serverTimestamp(),
    restoredBy: "reviewer",
    restoreReason: "Reason recorded on the account."
  });
  batch.set(doc(db, "socialMediaAccountsAudit", "restore-reason-mismatch"), {
    recordId: "archived-with-status",
    platform: "Facebook",
    accountName: "IRPA official Facebook Page — acceptance record",
    action: "STATUS_RESTORED",
    actorUid: "reviewer",
    actorEmail: "reviewer@example.test",
    reason: "Different reason in the audit event.",
    createdAt: serverTimestamp(),
    recordOrigin: "PRODUCTION"
  });
  await assertFails(batch.commit());
});

test("non-reviewer cannot write a standalone STATUS_RESTORED audit event", async () => {
  const db = env.authenticatedContext("communications-editor", {
    email: "editor@example.test",
    irpaRoles: ["Communications Officer"]
  }).firestore();
  await assertFails(setDoc(doc(db, "socialMediaAccountsAudit", "non-reviewer-standalone-restore"), {
    recordId: "archived-with-status",
    platform: "Facebook",
    accountName: "IRPA official Facebook Page — acceptance record",
    action: "STATUS_RESTORED",
    actorUid: "communications-editor",
    actorEmail: "editor@example.test",
    reason: "Unauthorized standalone restoration event.",
    createdAt: serverTimestamp(),
    recordOrigin: "PRODUCTION"
  }));
});

test("legacy archived record without previous status restores only to Pending Verification", async () => {
  const db = env.authenticatedContext("reviewer", {
    email: "reviewer@example.test", admin: true
  }).firestore();
  await assertSucceeds(restoreBatch(db, "legacy-archived", "Pending Verification", "Legacy record has no stored prior status; verify registration."));
  const snapshot = await getDoc(doc(db, "socialMediaAccounts", "legacy-archived"));
  assert.equal(snapshot.data().connectionStatus, "Pending Verification");
});

test("communications editor without reviewer authority cannot restore an archived account", async () => {
  const db = env.authenticatedContext("editor", {
    email: "editor@example.test", irpaRoles: ["Communications Manager"]
  }).firestore();
  await assertFails(restoreBatch(db, "archived-with-status", "Suspended", "Not authorized."));
});

test("restoration without a reason is denied", async () => {
  const db = env.authenticatedContext("reviewer", {
    email: "reviewer@example.test", admin: true
  }).firestore();
  const batch = writeBatch(db);
  batch.update(doc(db, "socialMediaAccounts", "archived-with-status"), {
    connectionStatus: "Suspended",
    restoredAt: serverTimestamp(),
    restoredBy: "reviewer",
    restoreReason: ""
  });
  await assertFails(batch.commit());
});

test("restoration cannot change credentials or unrelated account fields", async () => {
  const db = env.authenticatedContext("reviewer", {
    email: "reviewer@example.test", admin: true
  }).firestore();
  const batch = writeBatch(db);
  batch.update(doc(db, "socialMediaAccounts", "archived-with-status"), {
    connectionStatus: "Suspended",
    restoredAt: serverTimestamp(),
    restoredBy: "reviewer",
    restoreReason: "Review required.",
    accessToken: "must-not-be-added"
  });
  await assertFails(batch.commit());
});
