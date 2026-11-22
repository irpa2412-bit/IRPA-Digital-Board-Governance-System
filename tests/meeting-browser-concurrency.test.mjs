import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/meeting-portal-fixture-browser.yml", import.meta.url), "utf8");

test("browser runs cancel only within the same pull request or identical push commit group", () => {
  assert.match(workflow, /group: meeting-portal-browser-\$\{\{ github\.event\.pull_request\.number && format\('pr-\{0\}', github\.event\.pull_request\.number\) \|\| format\('ref-\{0\}-sha-\{1\}', github\.ref, github\.sha\) \}\}/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /github\.event\.pull_request\.number/);
  assert.match(workflow, /github\.ref, github\.sha/);
});
