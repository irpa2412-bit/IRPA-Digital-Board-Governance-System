const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PROJECT_ID,
  RELEASE_NAME,
  createBackup,
  validateBackup,
  restoreRelease
} = require("./staging-firestore-rules-release");

const source = "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }";
const previousRulesetName = `projects/${PROJECT_ID}/rulesets/previous-ruleset`;

function fixture() {
  const release = { name: RELEASE_NAME, rulesetName: previousRulesetName };
  const ruleset = {
    name: previousRulesetName,
    source: { files: [{ name: "firestore.rules", content: source }] }
  };
  return createBackup({ release, ruleset, savedAt: "2026-11-14T00:00:00.000Z" });
}

test("staging publisher captures and stores the backup before publish and rolls back on failure", () => {
  const fs = require("node:fs");
  const workflow = fs.readFileSync(".github/workflows/publish-staging-firestore-rules-only.yml", "utf8");
  const backup = workflow.indexOf("Capture active staging rules backup before publication");
  const artifact = workflow.indexOf("Save pre-publication staging rules backup artifact");
  const publish = workflow.indexOf("Publish staging rules to the fixed staging Firebase project");
  const verify = workflow.indexOf("Verify active staging release matches the staging source");
  const rollback = workflow.indexOf("Roll back staging rules to saved backup if publication or verification fails");
  assert.ok(backup >= 0 && artifact > backup && publish > artifact && verify > publish && rollback > verify);
  assert.match(workflow, /retention-days: 90/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /always\(\).*steps\.backup\.outcome == 'success'/);
  assert.match(workflow, /steps\.publish\.outcome != 'success' \|\| steps\.verify\.outcome != 'success'/);
  assert.match(workflow, /inputs\.confirm_staging_rules_publication == 'publish-staging-rules'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/fix\/signature-trail-20261024'/);
});

test("backup captures the exact active staging ruleset and content hash", () => {
  const backup = fixture();
  assert.equal(backup.projectId, PROJECT_ID);
  assert.equal(backup.releaseName, RELEASE_NAME);
  assert.equal(backup.rulesetName, previousRulesetName);
  assert.equal(backup.rulesSource, source);
  assert.equal(backup.rulesSourceSha256.length, 64);
  assert.doesNotThrow(() => validateBackup(backup));
});

test("rollback restores the previous ruleset and verifies the active release readback", async () => {
  const backup = fixture();
  let activeRuleset = `projects/${PROJECT_ID}/rulesets/new-ruleset`;
  const calls = [];
  const api = async (method, resource, data) => {
    calls.push({ method, resource, data });
    if (method === "GET" && resource === previousRulesetName) {
      return { name: previousRulesetName, source: { files: [{ name: "firestore.rules", content: source }] } };
    }
    if (method === "PATCH" && resource === RELEASE_NAME) {
      activeRuleset = data.release.rulesetName;
      return {};
    }
    if (method === "GET" && resource === RELEASE_NAME) return { name: RELEASE_NAME, rulesetName: activeRuleset };
    throw new Error("Unexpected mocked Rules API request.");
  };

  const result = await restoreRelease({ api, backup });
  assert.equal(result.ok, true);
  assert.equal(result.restoredRulesetName, previousRulesetName);
  assert.equal(activeRuleset, previousRulesetName);
  assert.ok(calls.some(call => call.method === "PATCH" && call.data.updateMask === "rulesetName"));
});

test("rollback recreates the saved ruleset if the original immutable ruleset is unavailable", async () => {
  const backup = fixture();
  let activeRuleset = "new-ruleset";
  let createdSource = null;
  const api = async (method, resource, data) => {
    if (method === "GET" && resource === previousRulesetName) {
      const error = new Error("not found");
      error.status = 404;
      throw error;
    }
    if (method === "POST") {
      createdSource = data.source.files[0].content;
      return { name: `projects/${PROJECT_ID}/rulesets/recreated-backup` };
    }
    if (method === "PATCH") {
      activeRuleset = data.release.rulesetName;
      return {};
    }
    if (method === "GET" && resource === RELEASE_NAME) return { rulesetName: activeRuleset };
    throw new Error("Unexpected mocked Rules API request.");
  };

  const result = await restoreRelease({ api, backup });
  assert.equal(createdSource, source);
  assert.equal(result.recreatedRuleset, true);
  assert.equal(activeRuleset, `projects/${PROJECT_ID}/rulesets/recreated-backup`);
});

test("rollback refuses a modified backup or a backup for another project", async () => {
  const backup = fixture();
  const altered = { ...backup, rulesSource: backup.rulesSource + " " };
  await assert.rejects(() => restoreRelease({ api: async () => ({}), backup: altered }), /hash does not match/);
  await assert.rejects(() => restoreRelease({ api: async () => ({}), backup: { ...backup, projectId: "production-project" } }), /fixed staging Firestore release/);
});
