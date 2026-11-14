const assert = require("node:assert/strict");
const fs = require("node:fs");
const { before, after, beforeEach, test } = require("node:test");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");

const rules = fs.readFileSync("firestore.rules", "utf8");
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
  assert.match(appSource, /if\(sessionAdministrator\)return true/);
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
    clearanceApprovedAt: new Date()
  }));
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
