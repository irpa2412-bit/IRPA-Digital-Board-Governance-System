const assert = require("node:assert/strict");
const {deleteField} = require("firebase/firestore");
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
    await db.doc("members/reviewer-user").set({
      uid: "reviewer-user",
      email: "reviewer@example.test",
      status: "Active",
      role: "Director Outreach"
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


test("non-administrator cannot create a TRIAL lifecycle record in production Firestore", async () => {
  const db = testEnv.authenticatedContext("member-user", {
    email: "member@example.test"
  }).firestore();
  await assertFails(db.doc("documents/LIFE-trial-denied").set(lifecycleDocument({
    documentId: "LIFE-trial-denied",
    recordOrigin: "TRIAL"
  })));
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


function translationRequest(overrides = {}) {
  return {
    requestType: "DOCUMENT_TRANSLATION",
    documentId: "LIFE-test-1",
    documentReference: "IRPA-DOC-2026-TEST0001",
    documentTitle: "Controlled test document",
    documentFileId: "drive-file-1",
    documentFileName: "test.txt",
    documentContentType: "text/plain",
    documentSha256: "a".repeat(64),
    documentOwnerUid: "member-user",
    requestedByUid: "member-user",
    sourceLanguage: "en",
    targetLanguage: "maa",
    targetLanguageLabel: "Maa (dictionary-assisted; human review)",
    requestNotes: "Non-confidential translation smoke test",
    documentClassification: "Internal",
    documentStage: "WORKING",
    status: "REQUESTED",
    dictionaryAssistRequested: true,
    humanReviewRequired: true,
    contentTransferred: false,
    requestOrigin: "Documents Portal",
    createdAt: "2026-10-10T06:00:00.000Z",
    updatedAt: "2026-10-10T06:00:00.000Z",
    ...overrides
  };
}

test("document owner can submit and retrieve their own translation request status", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("documents/LIFE-test-1").set(lifecycleDocument());
  });
  const ownerDb = testEnv.authenticatedContext("member-user", {email:"member@example.test"}).firestore();
  await assertSucceeds(ownerDb.doc("documentTranslationRequests/translation-test-1").set(translationRequest()));
  const snapshot = await assertSucceeds(ownerDb.doc("documentTranslationRequests/translation-test-1").get());
  assert.equal(snapshot.data().status, "REQUESTED");
  const unrelatedDb = testEnv.authenticatedContext("finance-user", {email:"finance@example.test"}).firestore();
  await assertFails(unrelatedDb.doc("documentTranslationRequests/translation-test-1").get());
});

test("document owner can explicitly transfer content and save a translation draft but cannot approve it", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("documents/LIFE-test-1").set(lifecycleDocument());
    await context.firestore().doc("documentTranslationRequests/translation-test-2").set(translationRequest());
  });
  const ownerDb = testEnv.authenticatedContext("member-user", {email:"member@example.test"}).firestore();
  await assertSucceeds(ownerDb.doc("documentTranslationRequests/translation-test-2").update({
    status:"IN_REVIEW",contentTransferred:true,translationStartedAt:"2026-10-10T06:05:00.000Z",
    sourceLanguageResolved:"en-TZ",translationDraftText:"Ashe. Enkare is sidai.",
    translationProvider:"IRPA Maa Dictionary · provisional glossary",sourceTextSha256:"b".repeat(64),
    extractedCharacterCount:35,translationChunks:1,translationCoverage:"partial",dictionaryMatchedTerms:3,
    updatedAt:"2026-10-10T06:05:00.000Z"
  }));
  await assertFails(ownerDb.doc("documentTranslationRequests/translation-test-2").update({
    status:"COMPLETED",translatedText:"Ashe. Enkare is sidai.",
    translationReviewedByUid:"member-user",reviewNotes:"Approved",completedAt:"2026-10-10T06:06:00.000Z",
    updatedAt:"2026-10-10T06:06:00.000Z"
  }));
});

test("Maa translation cannot be completed without an identified speaker review", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("documents/LIFE-test-1").set(lifecycleDocument());
    await context.firestore().doc("documentTranslationRequests/translation-test-3").set(translationRequest({
      status:"IN_REVIEW",contentTransferred:true,translationDraftText:"Ashe. Enkare is sidai."
    }));
  });
  const reviewerDb = testEnv.authenticatedContext("reviewer-user", {email:"reviewer@example.test"}).firestore();
  await assertFails(reviewerDb.doc("documentTranslationRequests/translation-test-3").update({
    status:"COMPLETED",translatedText:"Ashe. Enkare is sidai.",translationDraftText:deleteField(),
    translationReviewedByUid:"reviewer-user",reviewNotes:"Reviewed",translationReviewedAt:"2026-10-10T06:10:00.000Z",
    completedAt:"2026-10-10T06:10:00.000Z",updatedAt:"2026-10-10T06:10:00.000Z"
  }));
  await assertSucceeds(reviewerDb.doc("documentTranslationRequests/translation-test-3").update({
    status:"COMPLETED",translatedText:"Ashe. Enkare is sidai.",translationDraftText:deleteField(),
    translationReviewedByUid:"reviewer-user",reviewNotes:"Reviewed with local speaker; corrected spelling and usage.",
    maaSpeakerReview:{speakerName:"Test Maa Speaker",dialect:"Kisonko / Ilkisonko",reviewNotes:"Checked spelling and usage.",verifiedByUid:"reviewer-user",verifiedAt:"2026-10-10T06:10:00.000Z"},
    translationReviewedAt:"2026-10-10T06:10:00.000Z",
    completedAt:"2026-10-10T06:10:00.000Z",updatedAt:"2026-10-10T06:10:00.000Z"
  }));
});
