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


function lifecycleDocument(overrides = {}) {
  return {
    documentId: "LIFE-test-1",
    reference: "IRPA-DOC-2026-TEST0001",
    title: "Controlled test document",
    fileName: "test.pdf",
    fileId: "drive-file-1",
    storageProvider: "Google Drive",
    fileSize: 4,
    sha256: "a".repeat(64),
    ownerUid: "member-user",
    ownerType: "MEMBER",
    uploadedByUid: "member-user",
    department: "Governance",
    unit: "Governance Unit",
    documentType: "Other",
    archiveCategory: "Administrative Documents",
    classification: "Internal",
    accessPolicy: "IRPA_INTERNAL",
    authorizedUids: ["member-user"],
    authorizedRoles: [],
    authorizedDepartments: [],
    status: "WORKING",
    authorizationStatus: "AUTHORIZED",
    signatureStatus: "NOT_SENT",
    postSignatureStatus: "NOT_STARTED",
    finalArchiveStatus: "NOT_ARCHIVED",
    version: "1.0",
    archivePath: "IRPA Governance System/Document Lifecycle/01-Working Documents",
    uploadedAt: "2026-10-09T08:00:00.000Z",
    createdAt: "2026-10-09T08:00:00.000Z",
    updatedAt: "2026-10-09T08:00:00.000Z",
    recordOrigin: "PRODUCTION",
    ...overrides
  };
}

test("active document owner can create a valid internal lifecycle record", async () => {
  const db = testEnv.authenticatedContext("member-user", {
    email: "member@example.test"
  }).firestore();
  await assertSucceeds(db.doc("documents/LIFE-test-1").set(lifecycleDocument()));
});

test("document lifecycle creation denies restricted uploads without explicit role", async () => {
  const db = testEnv.authenticatedContext("member-user", {
    email: "member@example.test"
  }).firestore();
  await assertFails(db.doc("documents/LIFE-restricted").set(lifecycleDocument({
    documentId: "LIFE-restricted",
    classification: "Restricted",
    accessPolicy: "CONTROLLED"
  })));
});

test("document lifecycle category permissions deny governance members finance records", async () => {
  const db = testEnv.authenticatedContext("member-user", {
    email: "member@example.test"
  }).firestore();
  await assertFails(db.doc("documents/LIFE-finance-denied").set(lifecycleDocument({
    documentId: "LIFE-finance-denied",
    archiveCategory: "Finance Documents",
    department: "Governance"
  })));
});

test("finance role can create a finance lifecycle record", async () => {
  const db = testEnv.authenticatedContext("finance-user", {
    email: "finance@example.test",
    irpaRoles: ["Finance Manager"]
  }).firestore();
  await assertSucceeds(db.doc("documents/LIFE-finance-approved").set(lifecycleDocument({
    documentId: "LIFE-finance-approved",
    reference: "IRPA-DOC-2026-FIN00001",
    ownerUid: "finance-user",
    uploadedByUid: "finance-user",
    authorizedUids: ["finance-user"],
    ownerType: "MEMBER",
    archiveCategory: "Finance Documents",
    department: "Finance & Administration"
  })));
});

test("document owner can advance working document to pending signature", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("documents/LIFE-test-1").set(lifecycleDocument());
  });
  const db = testEnv.authenticatedContext("member-user", {
    email: "member@example.test"
  }).firestore();
  await assertSucceeds(db.doc("documents/LIFE-test-1").update({
    status: "PENDING_SIGNATURE",
    signatureStatus: "PENDING",
    signatureRequestedAt: "2026-10-09T08:10:00.000Z",
    signatureRequestedByUid: "member-user",
    updatedAt: "2026-10-09T08:10:00.000Z"
  }));
});

test("document owner cannot mark a pending document signed without a completed linked envelope", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("documents/LIFE-test-1").set(lifecycleDocument({
      status: "PENDING_SIGNATURE",
      signatureStatus: "PENDING"
    }));
  });
  const db = testEnv.authenticatedContext("member-user", {
    email: "member@example.test"
  }).firestore();
  await assertFails(db.doc("documents/LIFE-test-1").update({
    status: "SIGNED",
    signatureStatus: "COMPLETED",
    signatureEnvelopeId: "missing-envelope",
    signedAt: "2026-10-09T08:10:00.000Z",
    signedByUid: "member-user",
    updatedAt: "2026-10-09T08:10:00.000Z"
  }));
});

test("document lifecycle sharing is additive and cannot rewrite integrity fields", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("documents/LIFE-test-1").set(lifecycleDocument());
  });
  const db = testEnv.authenticatedContext("member-user", {
    email: "member@example.test"
  }).firestore();
  await assertSucceeds(db.doc("documents/LIFE-test-1").update({
    authorizedUids: ["member-user", "finance-user"],
    updatedAt: "2026-10-09T08:10:00.000Z"
  }));
  await assertFails(db.doc("documents/LIFE-test-1").update({
    sha256: "b".repeat(64)
  }));
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


test("finance role can read and create donor registry records", async () => {
  const db = testEnv.authenticatedContext("finance-user", {
    email: "finance@example.test",
    irpaRoles: ["Finance Manager"]
  }).firestore();
  await assertSucceeds(db.doc("donorFunders/donor-1").set({
    name: "Example Funder",
    recordType: "DONOR_FUNDER_REGISTRY",
    status: "Prospect"
  }));
  await assertSucceeds(db.doc("donorFunders/donor-1").get());
});

test("ordinary governance members cannot write donor registry or reporting obligations", async () => {
  const db = testEnv.authenticatedContext("member-user", {
    email: "member@example.test"
  }).firestore();
  await assertFails(db.doc("donorFunders/donor-2").set({
    name: "Blocked Funder",
    recordType: "DONOR_FUNDER_REGISTRY"
  }));
  await assertFails(db.doc("grantReportingObligations/obligation-1").set({
    donorId: "donor-1",
    dueDate: "2026-12-31",
    recordType: "GRANT_REPORTING_OBLIGATION"
  }));
});

test("document lifecycle records cannot be deleted by an ordinary owner", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("documents/LIFE-test-1").set(lifecycleDocument());
  });
  const db = testEnv.authenticatedContext("member-user", {
    email: "member@example.test"
  }).firestore();
  await assertFails(db.doc("documents/LIFE-test-1").delete());
});


test("working-to-signature transition cannot write later-stage archive fields", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("documents/LIFE-test-1").set(lifecycleDocument());
  });
  const db = testEnv.authenticatedContext("member-user", {
    email: "member@example.test"
  }).firestore();
  await assertFails(db.doc("documents/LIFE-test-1").update({
    status: "PENDING_SIGNATURE",
    signatureStatus: "PENDING",
    signatureRequestedAt: "2026-10-09T08:10:00.000Z",
    signatureRequestedByUid: "member-user",
    signedArchiveFileId: "forged-later-stage-file",
    updatedAt: "2026-10-09T08:10:00.000Z"
  }));
});

