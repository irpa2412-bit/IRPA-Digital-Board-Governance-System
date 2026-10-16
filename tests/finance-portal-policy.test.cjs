const assert = require("node:assert/strict");
const { before, after, beforeEach, test } = require("node:test");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const fs = require("node:fs");

let env;
const projectId = process.env.GCLOUD_PROJECT || "irpa-digital-board-governance";
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
    const db = context.firestore();
    await db.doc("members/finance-staff").set({status:"Active", department:"Finance & Administration", unit:"Finance Unit", role:"Finance Officer"});
    await db.doc("members/executive").set({status:"Active", department:"Executive Office", unit:"Executive Director's Office", role:"Executive Director"});
    await db.doc("members/outsider").set({status:"Active", department:"Environment & Sustainable Rangeland Management", unit:"Rangeland Management Unit", role:"Rangeland Officer"});
    await db.doc("financeTransactions/live-record").set({recordOrigin:"PRODUCTION",status:"Draft",workflowStage:"Draft",amount:500});
    await db.doc("financeTransactions/trial-record").set({recordOrigin:"TRIAL",status:"Draft",workflowStage:"Draft",postingStatus:"Unposted",amount:5});
    await db.doc("systemSettings/actualDataAccess").set({enabled:true,status:"OPEN",finalTestsAttested:true});
  });
});
const finance = () => env.authenticatedContext("finance-staff").firestore();
const executive = () => env.authenticatedContext("executive").firestore();
const outsider = () => env.authenticatedContext("outsider").firestore();
const admin = () => env.authenticatedContext("admin-user", {admin:true}).firestore();

test("Finance Department staff can read and create production finance records", async () => {
  await assertSucceeds(finance().doc("financeTransactions/live-record").get());
  await assertSucceeds(finance().doc("financeTransactions/new-record").set({recordOrigin:"PRODUCTION",status:"Draft",workflowStage:"Draft",amount:10}));
});
test("Administrator can read trial records but cannot read or create production transactions", async () => {
  await assertSucceeds(admin().doc("financeTransactions/trial-record").get());
  await assertFails(admin().doc("financeTransactions/live-record").get());
  await assertFails(admin().doc("financeTransactions/admin-live").set({recordOrigin:"PRODUCTION",status:"Draft",workflowStage:"Draft",amount:10}));
});
test("Administrator cannot finalize trial transactions", async () => {
  await assertFails(admin().doc("financeTransactions/trial-record").update({status:"Posted",workflowStage:"Posted",postingStatus:"Posted",postedAt:"now"}));
});
test("Assigned executive role is review-only, not full finance write access", async () => {
  await assertSucceeds(executive().doc("financeTransactions/live-record").get());
  await assertFails(executive().doc("financeTransactions/new-record").set({recordOrigin:"PRODUCTION",status:"Draft",workflowStage:"Draft",amount:10}));
});
test("Unassigned profile cannot read finance records", async () => {
  await assertFails(outsider().doc("financeTransactions/live-record").get());
  await assertFails(outsider().doc("financeTransactions/trial-record").get());
});
