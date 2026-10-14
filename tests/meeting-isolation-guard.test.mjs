import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/meeting-portal-fixture-browser.yml", import.meta.url), "utf8");

test("pull-request isolation baseline uses the captured PR base SHA", () => {
  assert.match(workflow, /const eventBase = process\.env\.PR_BASE_SHA\?\.trim\(\)/);
  assert.match(workflow, /const base = eventBase \|\| execFileSync\("git", \["merge-base", "origin\/main", "HEAD"\]/);
});

test("Wrangler changes cannot alter production configuration", () => {
  assert.match(workflow, /if \(changed\.includes\(wranglerPath\)\)/);
  assert.match(workflow, /productionSection\(baselineConfig, "Baseline Wrangler config"\) !== productionSection\(currentConfig, "Current Wrangler config"\)/);
  assert.match(workflow, /Production Wrangler configuration changed; only staging-only changes are permitted/);
});

test("staging keeps its dedicated KV namespace and rejects the production namespace", () => {
  assert.match(workflow, /id = "7b50627e29fc4fe1abaa8dc8665edd02"/);
  assert.match(workflow, /id = "ccdbffa662ac48bfbdf7f4b1f62ca941"/);
  assert.match(workflow, /Staging DRIVE_KV must retain the explicitly approved dedicated namespace/);
  assert.match(workflow, /Production DRIVE_KV cannot be used by staging/);
});

test("workflow-only guard maintenance requires its paired regression test", () => {
  assert.match(workflow, /const guardOnlyWorkflowRepair = changed\.includes\("\.github\/workflows\/meeting-portal-fixture-browser\.yml"\)/);
  assert.match(workflow, /changed\.includes\("tests\/meeting-isolation-guard\.test\.mjs"\)/);
  assert.match(workflow, /!guardOnlyWorkflowRepair/);
});
