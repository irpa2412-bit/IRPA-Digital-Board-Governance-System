import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const deployScript = fs.readFileSync(
  new URL("../functions/scripts/deploy-staging-firestore-rules.js", import.meta.url),
  "utf8"
);

test("staging rules publisher reads only the staging-specific source file", () => {
  assert.match(deployScript, /path\.resolve\("firestore\.staging\.rules"\)/);
  assert.doesNotMatch(deployScript, /path\.resolve\("firestore\.rules"\)/);
});

test("staging rules publisher remains locked to the isolated staging project", () => {
  assert.match(deployScript, /const PROJECT_ID = "irpa-dbg-staging-a73ec"/);
  assert.match(deployScript, /credentials\.project_id !== PROJECT_ID/);
  assert.match(deployScript, /projects\/\$\{PROJECT_ID\}\/rulesets/);
});

test("Firebase Rules API receives the canonical firestore.rules source filename", () => {
  assert.match(deployScript, /files: \[\{ name: "firestore\.rules", content: rulesContent \}\]/);
  assert.match(deployScript, /file\.name === "firestore\.rules"/);
});
