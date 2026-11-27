import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../../.github/workflows/staging-gateway-e2e.yml", import.meta.url), "utf8");

test("staging signature acceptance fails closed when a runtime check fails", () => {
  const start = workflow.indexOf("  other-portals-report:");
  const end = workflow.indexOf("  deploy-staging-frontend:", start);
  assert.ok(start >= 0 && end > start, "other-portals-report job must exist");
  const job = workflow.slice(start, end);
  assert.doesNotMatch(job, /^    continue-on-error: true$/m, "the report job itself must not mask acceptance failures");
  assert.match(job, /STAGING_ACCEPTANCE_GATE=FAIL/);
  assert.match(job, /exit 1/);
  assert.match(job, /STAGING_ACCEPTANCE_GATE=PASS/);
});

test("full signature staging deploy does not run the competing partial repair deployment", () => {
  const start = workflow.indexOf("  repair-staging:");
  const end = workflow.indexOf("  acceptance-staging:", start);
  assert.ok(start >= 0 && end > start, "repair-staging job must exist");
  const job = workflow.slice(start, end);
  assert.match(job, /github.ref != 'refs\/heads\/fix\/signature-pathway-20261025'/);
  assert.match(job, /github.ref != 'refs\/heads\/fix\/signature-trail-20261024'/);
});
