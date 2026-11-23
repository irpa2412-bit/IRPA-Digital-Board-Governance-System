const assert = require("node:assert/strict");
const fs = require("node:fs");
const { before, after, beforeEach, test } = require("node:test");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");

const rulesPath = process.env.FIRESTORE_RULES_FILE || "firestore.rules";
const rules = fs.readFileSync(rulesPath, "utf8");
const appSource = fs.readFileSync("src/App.jsx", "utf8");
const catalogue = JSON.parse(fs.readFileSync("config/org-structure-authority.json", "utf8"));
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-irpa-org-access-preservation",
    firestore: { rules }
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("systemSettings/actualDataAccess").set({
      enabled: true,
      status: "OPEN",
      finalTestsAttested: true
    });
  });
});

async function seedMeeting(id) {
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc(`meetings/${id}`).set({
      title: "Administrator preservation test",
      meetingCategory: "ADMINISTRATIVE",
      meetingPolicyId: "ADMINISTRATIVE",
      meetingType: "Management Meeting",
      initiatorUid: "test-initiator",
      initiatorEmail: "initiator@example.test",
      registerStatus: "Draft",
      status: "Scheduled"
    });
  });
}

test("primary owner administrator claim remains sufficient without a job-title dependency", async () => {
  await seedMeeting("owner-claim");
  const db = env.authenticatedContext("owner-primary", { admin: true }).firestore();
  await assertSucceeds(db.doc("meetings/owner-claim").delete());
});

test("active admin profile remains authoritative across role-title changes", async () => {
  const roleTitles = [
    "Administrator",
    "Executive Director",
    "Director Field",
    "Field Director",
    "Operations Director",
    "Research Director",
    "Communications Officer"
  ];

  for (let index = 0; index < roleTitles.length; index += 1) {
    const uid = `profile-admin-${index}`;
    const meetingId = `profile-admin-meeting-${index}`;
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await db.doc(`adminProfiles/${uid}`).set({ active: true });
      await db.doc(`members/${uid}`).set({
        uid,
        status: "Active",
        role: roleTitles[index]
      });
      await db.doc(`meetings/${meetingId}`).set({
        title: "Administrator preservation test",
        meetingCategory: "ADMINISTRATIVE",
        meetingPolicyId: "ADMINISTRATIVE",
        meetingType: "Management Meeting",
        initiatorUid: "test-initiator",
        initiatorEmail: "initiator@example.test",
        registerStatus: "Draft",
        status: "Scheduled"
      });
    });

    const db = env.authenticatedContext(uid).firestore();
    await assertSucceeds(db.doc(`meetings/${meetingId}`).delete());
  }
});

test("Administrator job title alone does not grant administrator authority", async () => {
  await seedMeeting("title-is-not-authority");
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("members/title-only-user").set({
      uid: "title-only-user",
      status: "Active",
      role: "Administrator"
    });
  });

  const db = env.authenticatedContext("title-only-user").firestore();
  await assertFails(db.doc("meetings/title-is-not-authority").delete());
});

test("administrator portal navigation includes every registered app module without consulting job descriptions", () => {
  assert.match(appSource, /const sessionAdministrator=Boolean\(admin\|\|profile\?\.authorizationType===["']administrator["']\)/);
  assert.match(appSource, /storedAuthority!=="Administrator"/);
  assert.match(appSource, /sessionAdministrator\|\|authority==="Administrator"/);
  assert.match(appSource, /if\(sessionAdministrator(?:\|\|institutionalReadOnlyAccess)?\)return true/);
  assert.match(appSource, /selected==="Administrator"\?\["Dashboard","Role Descriptions"\]/);
  assert.match(appSource, /modules=sessionAdministrator\?\[\.\.\.ALL_MODULES,\.\.\.registeredPortalModules\]/);
  assert.ok(appSource.includes("const ALL_MODULES="));
  assert.ok(appSource.includes("RoleJobDescriptionPortal"));
  assert.equal(catalogue.roles.find(role => role.id === "administrator")?.accessStatus,
    "DENY_UNTIL_RULES_AND_OWNER_APPROVAL",
    "the draft job catalogue must not become administrator runtime authority");
});


test("explicitly registered research authority cannot read restricted records before clearance", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("members/research-authority").set({
      uid: "research-authority",
      status: "Active",
      role: "Research Officer"
    });
    await db.doc("researchAuthorities/research-authority").set({
      uid: "research-authority",
      active: true,
      status: "Active",
      displayName: "Research Officer",
      appointmentReference: "TEST-RESEARCH-AUTHORITY-APPOINTMENT",
      appointedByUid: "owner-primary"
    });
    await db.doc("researchStudies/research-authority-record").set({
      title: "Restricted research record",
      classification: "RESTRICTED",
      sharingStatus: "NOT_CLEARED",
      clearedForSharing: false,
      recordOrigin: "TRIAL"
    });
  });

  const researcher = env.authenticatedContext("research-authority").firestore();
  await assertFails(researcher.doc("researchStudies/research-authority-record").get());
});

test("research authority cannot clear a record until an active custodian is registered", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("members/research-authority").set({
      uid: "research-authority",
      status: "Active",
      role: "Research Officer"
    });
    await db.doc("researchAuthorities/research-authority").set({
      uid: "research-authority",
      active: true,
      status: "Active",
      displayName: "Research Officer",
      appointmentReference: "TEST-RESEARCH-AUTHORITY-APPOINTMENT",
      appointedByUid: "owner-primary"
    });
    await db.doc("researchStudies/research-clearance-test").set({
      title: "Restricted clearance test",
      classification: "RESTRICTED",
      sharingStatus: "NOT_CLEARED",
      clearedForSharing: false,
      recordOrigin: "TRIAL"
    });
  });

  const researcher = env.authenticatedContext("research-authority").firestore();
  await assertFails(researcher.doc("researchStudies/research-clearance-test").update({
    classification: "CONFIDENTIAL",
    sharingStatus: "CLEARED_FOR_SHARING",
    clearedForSharing: true,
    clearanceApprovedByUid: "research-authority",
    clearanceApprovedByName: "Research Officer",
    clearanceApprovedAt: new Date(),
    custodianUid: "unappointed-custodian",
    custodianName: "Unappointed Custodian"
  }));
});

test("unresolved Research Director title does not confer research authority", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("members/unresolved-research-director").set({
      uid: "unresolved-research-director",
      status: "Active",
      role: "Research Director"
    });
    await db.doc("researchStudies/unresolved-research-director-record").set({
      title: "Restricted research record",
      classification: "RESTRICTED",
      sharingStatus: "NOT_CLEARED",
      clearedForSharing: false,
      recordOrigin: "TRIAL"
    });
  });

  const unresolved = env.authenticatedContext("unresolved-research-director").firestore();
  await assertFails(unresolved.doc("researchStudies/unresolved-research-director-record").get());
});

test("research authority cannot review an unrelated Finance portal request", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("members/research-authority").set({
      uid: "research-authority",
      status: "Active",
      role: "Research Officer"
    });
    await db.doc("researchAuthorities/research-authority").set({
      uid: "research-authority",
      active: true,
      status: "Active",
      displayName: "Research Officer",
      appointmentReference: "TEST-RESEARCH-AUTHORITY-APPOINTMENT",
      appointedByUid: "owner-primary"
    });
    await db.doc("researchInformationRequests/finance-portal-request").set({
      requestType: "DATA_ACCESS",
      requestedByUid: "finance-requester",
      targetPortal: "Finance Portfolio",
      status: "Submitted",
      recordOrigin: "TRIAL",
      createdAt: new Date(),
      updatedAt: new Date()
    });
  });

  const researcher = env.authenticatedContext("research-authority").firestore();
  await assertFails(researcher.doc("researchInformationRequests/finance-portal-request").update({
    status: "Approved",
    decisionReason: "Research authority must not approve finance portal requests.",
    reviewedAt: new Date(),
    reviewedByPortal: "Finance Portfolio",
    updatedAt: new Date()
  }));
});

test("Research Officer title alone cannot clear a record even when a custodian exists", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("members/research-officer-title-only").set({
      uid: "research-officer-title-only",
      status: "Active",
      role: "Research Officer"
    });
    await db.doc("researchCustodians/custodian-title-only").set({
      uid: "custodian-title-only",
      active: true,
      status: "Active",
      displayName: "Named Custodian",
      appointmentReference: "TEST-CUSTODIAN-APPOINTMENT"
    });
    await db.doc("researchStudies/title-only-clearance").set({
      title: "Restricted research study",
      classification: "RESTRICTED",
      sharingStatus: "NOT_CLEARED",
      clearedForSharing: false,
      recordOrigin: "TRIAL"
    });
  });

  const titleOnly = env.authenticatedContext("research-officer-title-only").firestore();
  await assertFails(titleOnly.doc("researchStudies/title-only-clearance").update({
    classification: "CONFIDENTIAL",
    sharingStatus: "CLEARED_FOR_SHARING",
    clearedForSharing: true,
    clearanceApprovedByUid: "research-officer-title-only",
    clearanceApprovedByName: "Research Officer",
    clearanceApprovedAt: new Date(),
    custodianUid: "custodian-title-only",
    custodianName: "Named Custodian"
  }));
});

test("client administrators cannot self-appoint research authorities or custodians", async () => {
  const owner = env.authenticatedContext("owner-primary", { admin: true }).firestore();
  await assertFails(owner.doc("researchAuthorities/owner-primary").set({
    uid: "owner-primary",
    active: true,
    status: "Active",
    displayName: "Owner",
    appointmentReference: "SELF-APPOINTMENT"
  }));
  await assertFails(owner.doc("researchCustodians/owner-primary").set({
    uid: "owner-primary",
    active: true,
    status: "Active",
    displayName: "Owner",
    appointmentReference: "SELF-APPOINTMENT"
  }));
});

test("only a research authority with an active appointed custodian can clear a record for sharing", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("members/research-authority").set({ uid: "research-authority", status: "Active", role: "Research Officer" });
    await db.doc("researchAuthorities/research-authority").set({
      uid: "research-authority",
      active: true,
      status: "Active",
      displayName: "Research Officer",
      appointmentReference: "TEST-RESEARCH-AUTHORITY-APPOINTMENT",
      appointedByUid: "owner-primary"
    });
    await db.doc("researchCustodians/custodian-1").set({
      uid: "custodian-1",
      active: true,
      status: "Active",
      displayName: "Named Research Custodian",
      appointmentReference: "TEST-CUSTODIAN-APPOINTMENT",
      appointedByUid: "owner-primary"
    });
    await db.doc("researchStudies/clearance-success").set({
      title: "Restricted study awaiting clearance",
      classification: "RESTRICTED",
      sharingStatus: "NOT_CLEARED",
      clearedForSharing: false,
      recordOrigin: "TRIAL"
    });
  });

  const researcher = env.authenticatedContext("research-authority").firestore();
  await assertSucceeds(researcher.doc("researchStudies/clearance-success").update({
    classification: "CONFIDENTIAL",
    sharingStatus: "CLEARED_FOR_SHARING",
    clearedForSharing: true,
    clearanceApprovedByUid: "research-authority",
    clearanceApprovedByName: "Research Officer",
    clearanceApprovedAt: new Date(),
    custodianUid: "custodian-1",
    custodianName: "Named Research Custodian"
  }));

  const ordinaryUser = env.authenticatedContext("ordinary-reader").firestore();
  await assertSucceeds(ordinaryUser.doc("researchStudies/clearance-success").get());
});

test("Published status does not make research updates readable to ordinary users", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("researchUpdates/published-restricted-update").set({
      title: "Restricted research update",
      status: "Published",
      classification: "RESTRICTED",
      clearedForSharing: false,
      recordOrigin: "TRIAL"
    });
  });

  const ordinaryMember = env.authenticatedContext("ordinary-member").firestore();
  await assertFails(ordinaryMember.doc("researchUpdates/published-restricted-update").get());
});

test("restricted research studies remain unreadable until separately cleared for sharing", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("researchStudies/restricted-test-record").set({
      title: "Restricted test record",
      classification: "RESTRICTED",
      sharingStatus: "NOT_CLEARED",
      clearedForSharing: false,
      recordOrigin: "TRIAL"
    });
  });

  const owner = env.authenticatedContext("owner-primary", { admin: true }).firestore();
  await assertFails(owner.doc("researchStudies/restricted-test-record").get());
});


test("Executive Director and Director Internal Oversight receive cross-department read access only", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("members/executive-reader").set({ uid: "executive-reader", status: "Active", role: "Executive Director" });
    await db.doc("employees/oversight-reader").set({ uid: "oversight-reader", employmentStatus: "Active", title: "Director Internal Oversight" });
    await db.doc("reports/cross-department-report").set({ title: "Cross-department report", recordOrigin: "PRODUCTION" });
    await db.doc("procurementVendorScores/cross-department-score").set({ vendorId: "vendor-1", year: 2026, totalScore: 8, maximumScore: 10, recordOrigin: "PRODUCTION" });
    await db.doc("audit/cross-department-audit").set({ action: "TEST_READ", recordOrigin: "PRODUCTION" });
    await db.doc("financeTransactions/cross-department-finance").set({ recordOrigin: "PRODUCTION", status: "Posted", amount: 100, currency: "TZS" });
    await db.doc("researchStudies/oversight-restricted-study").set({ classification: "RESTRICTED", sharingStatus: "NOT_CLEARED", clearedForSharing: false, recordOrigin: "PRODUCTION" });
  });
  const executive = env.authenticatedContext("executive-reader").firestore();
  const oversight = env.authenticatedContext("oversight-reader").firestore();
  for (const db of [executive, oversight]) {
    await assertSucceeds(db.doc("reports/cross-department-report").get());
    await assertSucceeds(db.doc("procurementVendorScores/cross-department-score").get());
    await assertSucceeds(db.doc("audit/cross-department-audit").get());
    await assertSucceeds(db.doc("financeTransactions/cross-department-finance").get());
    await assertFails(db.doc("researchStudies/oversight-restricted-study").get());
    await assertFails(db.doc("procurementVendorScores/cross-department-score").update({ totalScore: 9 }));
  }
});

test("inactive Director Internal Oversight identity does not receive cross-department access", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("employees/inactive-oversight").set({ uid: "inactive-oversight", employmentStatus: "Inactive", title: "Director Internal Oversight" });
    await db.doc("reports/inactive-oversight-report").set({ title: "Protected report", recordOrigin: "PRODUCTION" });
  });
  const inactive = env.authenticatedContext("inactive-oversight").firestore();
  await assertFails(inactive.doc("reports/inactive-oversight-report").get());
});

test("institutional oversight comments, queries and remarks are append-only and role-scoped", async () => {
  const { addDoc, collection, serverTimestamp } = require("firebase/firestore");
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("employees/oversight-writer").set({ uid: "oversight-writer", status: "Active", role: "Director Internal Oversight" });
  });
  const oversight = env.authenticatedContext("oversight-writer").firestore();
  const created = await addDoc(collection(oversight, "institutionalOversightNotes"), {
    recordType: "Institutional Oversight Note", portalName: "Finance Portfolio",
    departmentName: "Finance & Administration", recordReference: "FIN-2026-001",
    type: "QUERY", message: "Please clarify the supporting document.",
    authorUid: "oversight-writer", authorName: "Oversight Director",
    authorRole: "Director Internal Oversight", createdAt: serverTimestamp(), recordOrigin: "PRODUCTION"
  });
  await assertSucceeds(oversight.doc("institutionalOversightNotes/" + created.id).get());
  await assertFails(oversight.doc("institutionalOversightNotes/" + created.id).update({ message: "Changed" }));
  await assertFails(oversight.doc("institutionalOversightNotes/" + created.id).delete());
  const ordinary = env.authenticatedContext("ordinary-reader").firestore();
  await assertFails(ordinary.doc("institutionalOversightNotes/" + created.id).get());
});

test("cross-department portal navigation and oversight notes remain separate from administrative and signing controls", () => {
  assert.ok(appSource.includes('institutionalReadOnlyAccess=["Executive Director","Director Internal Oversight"].includes(selectedAuthority)'));
  assert.ok(appSource.includes("if(sessionAdministrator||institutionalReadOnlyAccess)return true"));
  assert.ok(appSource.includes("modules=sessionAdministrator?[...ALL_MODULES,...registeredPortalModules]:institutionalReadOnlyAccess?"));
  assert.ok(appSource.includes("InstitutionalOversightNotes activePortal={active}"));
  assert.ok(appSource.includes('"Signature Platform","Signing Workspace","Post-Signature Work","Final Archive","Upload Document","Retrieve Archived Documents","Email Signing","Authorization & Approvals","Voting"'));
});
