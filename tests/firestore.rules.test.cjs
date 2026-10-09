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


test("controlled documents accept the supported MIME types", async () => {
  const db = testEnv.authenticatedContext("member-user", {
    email: "member@example.test"
  }).firestore();

  const types = [
    "application/pdf", "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
    "application/rtf", "text/plain", "text/csv",
    "text/tab-separated-values", "text/markdown", "text/html",
    "application/xhtml+xml", "application/epub+zip", "application/json",
    "application/xml", "text/xml", "image/png", "image/jpeg",
    "image/webp", "image/svg+xml"
  ];

  for (let i = 0; i < types.length; i++) {
    await assertSucceeds(db.doc(`documents/mime-allowed-${i}`).set({
      uploadedByUid: "member-user",
      status: "Draft",
      authorizationStatus: "Draft",
      authorizedUids: ["member-user"],
      recordOrigin: "PRODUCTION",
      fileName: `test-file-${i}`,
      contentType: types[i]
    }));
  }
});

test("controlled documents reject unsupported MIME types", async () => {
  const db = testEnv.authenticatedContext("member-user", {
    email: "member@example.test"
  }).firestore();

  await assertFails(db.doc("documents/mime-rejected").set({
    uploadedByUid: "member-user",
    status: "Draft",
    authorizationStatus: "Draft",
    authorizedUids: ["member-user"],
    recordOrigin: "PRODUCTION",
    fileName: "unsupported.bin",
    contentType: "application/octet-stream"
  }));
});

test("controlled documents retain uploader and authorization restrictions", async () => {
  const db = testEnv.authenticatedContext("member-user", {
    email: "member@example.test"
  }).firestore();

  const valid = {
    status: "Draft",
    authorizationStatus: "Draft",
    authorizedUids: ["member-user"],
    recordOrigin: "PRODUCTION",
    fileName: "document.pdf",
    contentType: "application/pdf"
  };

  await assertFails(db.doc("documents/wrong-uploader").set({
    ...valid, uploadedByUid: "another-user"
  }));

  await assertFails(db.doc("documents/missing-authorization").set({
    ...valid, uploadedByUid: "member-user", authorizedUids: []
  }));
});
