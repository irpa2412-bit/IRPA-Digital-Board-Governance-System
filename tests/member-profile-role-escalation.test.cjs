const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const fs = require("node:fs");
const { initializeTestEnvironment, assertSucceeds } = require("@firebase/rules-unit-testing");

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-irpa-member-role-array-proof",
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") }
  });
});

after(async () => {
  await env.cleanup();
});

test("an invited active member can add role entries to their own profile", async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("invitations/INV-ROLE-ARRAY-TEST").set({
      email: "member@example.test",
      role: "Member",
      memberType: "Governance Member",
      status: "Accepted"
    });
    await db.doc("members/invited-member").set({
      uid: "invited-member",
      email: "member@example.test",
      status: "Active",
      role: "Member",
      memberType: "Governance Member",
      invitationId: "INV-ROLE-ARRAY-TEST"
    });
  });

  const db = env.authenticatedContext("invited-member", {
    email: "member@example.test"
  }).firestore();
  const profile = db.doc("members/invited-member");

  for (const field of ["roles", "assignedRoles", "selectedRoles"]) {
    await assertSucceeds(profile.update({
      [field]: ["Executive Director"]
    }));
  }
});
