import test from "node:test";
import assert from "node:assert/strict";
import { parseOwnerRenewalCommand, resolveOnePortalForFiles } from "../scripts/portal-repair-window-renewal.mjs";
import fs from "node:fs";
const registry = JSON.parse(fs.readFileSync(new URL("../docs/portal-protection/portal-register.json", import.meta.url), "utf8"));
const names = Object.keys(registry.portals);

test("APPROVE command binds the exact PR number and preserves the full reason", () => {
  assert.deepEqual(parseOwnerRenewalCommand("APPROVE 845 renew the Meeting Portal window", names), {
    kind: "approve", prNumber: 845, reason: "renew the Meeting Portal window"
  });
});
test("RENEW command resolves one exact portal name and reason", () => {
  assert.deepEqual(parseOwnerRenewalCommand("RENEW Meeting Portal continue the approved repair", names), {
    kind: "renew", portal: "Meeting Portal", reason: "continue the approved repair"
  });
});
test("unknown portal, missing reason, and ambiguous command fail closed", () => {
  assert.equal(parseOwnerRenewalCommand("RENEW Unknown Portal reason", names), null);
  assert.equal(parseOwnerRenewalCommand("RENEW Meeting Portal", names), null);
  assert.equal(parseOwnerRenewalCommand("APPROVE 845", names), null);
});
test("PR file resolution returns one portal when isolated record and portal files agree", () => {
  assert.equal(resolveOnePortalForFiles([
    "src/pages/Meetings.jsx",
    "docs/portal-protection/records/meeting-portal.json"
  ], registry), "Meeting Portal");
});
test("shared dependencies and cross-portal PRs cannot be renewed", () => {
  assert.equal(resolveOnePortalForFiles(["src/App.jsx"], registry), null);
  assert.equal(resolveOnePortalForFiles(["src/pages/Meetings.jsx", "src/pages/SignaturePlatform.jsx"], registry), null);
});


test("renewal workflow is owner-only, PR-scoped, 72 hours and records the exact quotation", () => {
  const workflow = fs.readFileSync(new URL("../.github/workflows/portal-repair-window-renewal.yml", import.meta.url), "utf8");
  assert.match(workflow, /author_association == 'OWNER'/);
  assert.match(workflow, /comment\\.user\\.login !== repoInfo\\.data\\.owner\\.login/);
  assert.match(workflow, /72 \\* 60 \\* 60 \\* 1000/);
  assert.match(workflow, /quotedApproval: quote/);
  assert.match(workflow, /record\\.renewals/);
  assert.match(workflow, /docs\\/approvals\\.md/);
  assert.match(workflow, /multi-portal PRs cannot be renewed/);
  assert.match(workflow, /Renewal commands must be posted on a pull request/);
});
