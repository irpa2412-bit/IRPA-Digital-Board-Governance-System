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
