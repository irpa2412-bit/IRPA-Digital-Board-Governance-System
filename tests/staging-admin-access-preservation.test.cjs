const assert = require("node:assert/strict");
const fs = require("node:fs");
const { before, after, beforeEach, test } = require("node:test");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-irpa-staging",
    firestore: { rules: fs.readFileSync("firestore.staging.rules", "utf8") }
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("systemSettings/actualDataAccess").set({
      enabled: true,
      status: "OPEN",
      finalTestsAttested: true
    });
  });
});

async function seedMeeting(id) {
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc(`meetings/${id}`).set({
      title: "Staging administrator access preservation test",
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

test("primary administrator claim remains recognised independently of job title", async () => {
  await seedMeeting("primary-admin-claim");
  const db = env.authenticatedContext("owner-primary", { admin: true }).firestore();
  await assertSucceeds(db.doc("meetings/primary-admin-claim").delete());
});

test("active adminProfiles identity remains administrator across organisational role-title changes", async () => {
  const titles = [
    "Administrator",
    "Executive Director",
    "Director Field",
    "Field Director",
    "Operations Director",
    "Research Director",
    "Communications Officer"
  ];

  for (let index = 0; index < titles.length; index += 1) {
    const uid = `staging-admin-${index}`;
    const meetingId = `staging-admin-meeting-${index}`;
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await db.doc(`adminProfiles/${uid}`).set({ active: true });
      await db.doc(`members/${uid}`).set({ uid, status: "Active", role: titles[index] });
      await db.doc(`meetings/${meetingId}`).set({
        title: "Staging administrator access preservation test",
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

test("a role title of Administrator without an active adminProfiles record does not grant administrator access", async () => {
  await seedMeeting("role-title-only");
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("members/title-only").set({
      uid: "title-only",
      status: "Active",
      role: "Administrator"
    });
  });

  const db = env.authenticatedContext("title-only").firestore();
  await assertFails(db.doc("meetings/role-title-only").delete());
});

test("active Research authority cannot read restricted research before clearance", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("members/research-authority").set({ uid: "research-authority", status: "Active", role: "Research Officer" });
    await db.doc("researchAuthorities/research-authority").set({
      uid: "research-authority",
      active: true,
      status: "Active",
      displayName: "Research Officer",
      appointmentReference: "TEST-RESEARCH-AUTHORITY-APPOINTMENT"
    });
    await db.doc("researchStudies/research-authority-study").set({
      title: "Restricted research study",
      classification: "RESTRICTED",
      sharingStatus: "NOT_CLEARED",
      clearedForSharing: false,
      recordOrigin: "TRIAL"
    });
  });

  const researcher = env.authenticatedContext("research-authority").firestore();
  await assertFails(researcher.doc("researchStudies/research-authority-study").get());
});

test("Research Officer title alone cannot clear a study even when a custodian exists", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("members/research-officer-title-only").set({
      uid: "research-officer-title-only",
      status: "Active",
      role: "Research Officer"
    });
    await db.doc("researchCustodians/custodian-1").set({
      uid: "custodian-1",
      active: true,
      status: "Active",
      displayName: "Named Custodian",
      appointmentReference: "TEST-CUSTODIAN-APPOINTMENT"
    });
    await db.doc("researchStudies/title-only-study").set({
      title: "Restricted research study",
      classification: "RESTRICTED",
      sharingStatus: "NOT_CLEARED",
      clearedForSharing: false,
      recordOrigin: "TRIAL"
    });
  });

  const titleOnly = env.authenticatedContext("research-officer-title-only").firestore();
  await assertFails(titleOnly.doc("researchStudies/title-only-study").update({
    classification: "CONFIDENTIAL",
    sharingStatus: "CLEARED_FOR_SHARING",
    clearedForSharing: true,
    clearanceApprovedByUid: "research-officer-title-only",
    clearanceApprovedByName: "Research Officer",
    clearanceApprovedAt: new Date(),
    custodianUid: "custodian-1",
    custodianName: "Named Custodian"
  }));
});

test("research authority cannot clear a study without an active custodian", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("members/research-authority").set({ uid: "research-authority", status: "Active", role: "Research Officer" });
    await db.doc("researchAuthorities/research-authority").set({
      uid: "research-authority",
      active: true,
      status: "Active",
      displayName: "Research Officer",
      appointmentReference: "TEST-RESEARCH-AUTHORITY-APPOINTMENT"
    });
    await db.doc("researchStudies/no-custodian-study").set({
      title: "Restricted research study",
      classification: "RESTRICTED",
      sharingStatus: "NOT_CLEARED",
      clearedForSharing: false,
      recordOrigin: "TRIAL"
    });
  });

  const researcher = env.authenticatedContext("research-authority").firestore();
  await assertFails(researcher.doc("researchStudies/no-custodian-study").update({
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

test("active authority and custodian are required before a research record can be cleared and read", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("members/research-authority").set({ uid: "research-authority", status: "Active", role: "Research Officer" });
    await db.doc("researchAuthorities/research-authority").set({
      uid: "research-authority",
      active: true,
      status: "Active",
      displayName: "Research Officer",
      appointmentReference: "TEST-RESEARCH-AUTHORITY-APPOINTMENT"
    });
    await db.doc("researchCustodians/custodian-2").set({
      uid: "custodian-2",
      active: true,
      status: "Active",
      displayName: "Named Custodian",
      appointmentReference: "TEST-CUSTODIAN-APPOINTMENT"
    });
    await db.doc("researchStudies/clearable-study").set({
      title: "Restricted research study",
      classification: "RESTRICTED",
      sharingStatus: "NOT_CLEARED",
      clearedForSharing: false,
      recordOrigin: "TRIAL"
    });
  });

  const researcher = env.authenticatedContext("research-authority").firestore();
  await assertSucceeds(researcher.doc("researchStudies/clearable-study").update({
    classification: "CONFIDENTIAL",
    sharingStatus: "CLEARED_FOR_SHARING",
    clearedForSharing: true,
    clearanceApprovedByUid: "research-authority",
    clearanceApprovedByName: "Research Officer",
    clearanceApprovedAt: new Date(),
    custodianUid: "custodian-2",
    custodianName: "Named Custodian"
  }));
  const ordinaryUser = env.authenticatedContext("ordinary-reader").firestore();
  await assertSucceeds(ordinaryUser.doc("researchStudies/clearable-study").get());
});

test("client administrator cannot self-appoint research authority or custodian", async () => {
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

test("Published status does not grant ordinary users access to research updates", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("researchUpdates/published-restricted").set({
      title: "Restricted research update",
      status: "Published",
      classification: "RESTRICTED",
      clearedForSharing: false,
      recordOrigin: "TRIAL"
    });
  });

  const ordinaryMember = env.authenticatedContext("ordinary-member").firestore();
  await assertFails(ordinaryMember.doc("researchUpdates/published-restricted").get());
});

test("RESTRICTED research records cannot be read merely because the caller is an administrator", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("researchStudies/restricted-staging-test").set({
      title: "Restricted staging test record",
      classification: "RESTRICTED",
      sharingStatus: "NOT_CLEARED",
      clearedForSharing: false,
      recordOrigin: "TRIAL"
    });
  });

  const owner = env.authenticatedContext("owner-primary", { admin: true }).firestore();
  await assertFails(owner.doc("researchStudies/restricted-staging-test").get());
});
