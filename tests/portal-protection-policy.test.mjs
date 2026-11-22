import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy, parseActivityTimestamps, portalPolicyPaths, resolvePortalPolicyPaths } from "../scripts/portal-protection-check.mjs";
import fs from "node:fs";
const registry = JSON.parse(fs.readFileSync(new URL("../docs/portal-protection/portal-register.json", import.meta.url), "utf8"));

const portal = "Signature Portal";
const now = Date.parse("2026-11-19T20:00:00Z");
const file = "src/pages/SignaturePlatform.jsx";
const valid = {
  status: "complete",
  declaration: { affectedPortals: [portal, "Meeting Portal"], reason: "Repair", files: [file], expectedEffect: "Fix scoped defect", prohibitedChanges: ["No signing rule changes"] },
  baseline: { commit: "433727282012c75cdaebca21dcdadcb28dba59fb", rollbackCommit: "433727282012c75cdaebca21dcdadcb28dba59fb" },
  validation: {
    baselineSmoke: "PASS",
    fullRegression: "PASS",
    portalSmoke: { [portal]: "PASS", "Meeting Portal": "PASS" },
    evidence: [
      "Baseline smoke PASS for 433727282012c75cdaebca21dcdadcb28dba59fb https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/1/job/11",
      "Full regression PASS for 433727282012c75cdaebca21dcdadcb28dba59fb https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/1/job/12",
      "Signature Portal portal smoke PASS for 433727282012c75cdaebca21dcdadcb28dba59fb https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/1/job/13"
    ],
    behaviourDifferences: []
  }
};
const windowState = { status: "open", openedAt: "2026-11-19T18:00:00Z", scope: [file] };
const run = (changedFiles, record = valid, win = windowState, activity = "2026-11-19T19:59:00Z") =>
  evaluatePolicy({ changedFiles, registry, record, windowState: win, latestActivityAt: activity, now });

test("protected change without Change Record fails", () => assert.equal(run([file], null).ok, false));
test("valid record and active scoped window pass", () => assert.equal(run([file]).ok, true));
test("active amendment file declarations extend the original change record", () => {
  const amended = { ...valid, declaration: { ...valid.declaration, files: [] }, activeAmendment: { files: [file] } };
  assert.equal(run([file], amended).ok, true);
});
test("24-hour inactivity closes the window", () => assert.equal(run([file], valid, windowState, "2026-11-18T19:59:00Z").ok, false));
test("out-of-scope protected change fails", () => assert.equal(run([file], valid, { ...windowState, scope: ["src/pages/Invitations.jsx"] }).ok, false));
test("multi-portal shared dependency changes fail even with a complete shared record", () => {
  const result = run(["src/App.jsx"], { ...valid, declaration: { ...valid.declaration, affectedPortals: Object.keys(registry.portals), files: ["src/App.jsx"] }, validation: { ...valid.validation, portalSmoke: Object.fromEntries(Object.keys(registry.portals).map(p => [p, "PASS"])) } }, { ...windowState, scope: ["src/App.jsx"] });
  assert.equal(result.affected.length, 7);
  assert.equal(result.ok, false);
  assert.match(result.reason, /one-portal PRs/);
});
test("unrelated change passes without a repair window", () => assert.equal(run(["README.md"], null, null).ok, true));

test("a new commit cannot silently reopen a window after a 24-hour gap", () => {
  const result = evaluatePolicy({ changedFiles: [file], registry, record: valid, windowState, activityTimestamps: ["2026-11-19T18:30:00Z", "2026-11-20T19:00:00Z"], now: Date.parse("2026-11-20T19:01:00Z") });
  assert.equal(result.ok, false);
});
test("a fresh declaration reopens after an earlier closure", () => {
  const reopened = { ...windowState, openedAt: "2026-11-20T18:00:00Z" };
  const result = evaluatePolicy({ changedFiles: [file], registry, record: valid, windowState: reopened, activityTimestamps: ["2026-11-19T19:00:00Z", "2026-11-20T18:30:00Z"], now: Date.parse("2026-11-20T18:31:00Z") });
  assert.equal(result.ok, true);
});


test("Git activity history is parsed into individual timestamps", () => {
  assert.deepEqual(parseActivityTimestamps("2026-11-19T21:10:19Z\n2026-11-19T21:11:00Z\n"), ["2026-11-19T21:10:19Z","2026-11-19T21:11:00Z"]);
});

test("single-portal changes resolve to isolated per-portal records", () => {
  assert.deepEqual(portalPolicyPaths(["Meeting Portal"]), {
    windowPath: "docs/portal-protection/windows/meeting-portal.json",
    recordPath: "docs/portal-protection/records/meeting-portal.json"
  });
});
test("shared or multi-portal changes retain the shared protection record", () => {
  assert.equal(portalPolicyPaths(["Meeting Portal", "Signature Portal"]), null);
  assert.equal(portalPolicyPaths([]), null);
});

test("a single portal requires both its own repair window and its own Change Record", () => {
  const selected = resolvePortalPolicyPaths(["Meeting Portal"], () => true);
  assert.equal(selected.ok, true);
  assert.equal(selected.windowPath, "docs/portal-protection/windows/meeting-portal.json");
  assert.equal(selected.recordPath, "docs/portal-protection/records/meeting-portal.json");
  const missing = resolvePortalPolicyPaths(["Meeting Portal"], path => path.endsWith("windows/meeting-portal.json"));
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /shared records cannot substitute/);
});

test("a multi-portal change cannot select or fall back to any shared record", () => {
  const selected = resolvePortalPolicyPaths(["Meeting Portal", "Signature Portal"], () => true);
  assert.equal(selected.ok, false);
  assert.match(selected.reason, /one-portal PRs/);
});

test("PASS labels without real-run links for the exact baseline cannot pass", () => {
  const noEvidence = { ...valid, validation: { ...valid.validation, evidence: [] } };
  const result = run([file], noEvidence);
  assert.equal(result.ok, false);
  assert.match(result.reason, /real-run links/);
});

test("portal smoke PASS requires portal-specific real-run evidence", () => {
  const missingPortalLink = {
    ...valid,
    validation: {
      ...valid.validation,
      evidence: valid.validation.evidence.filter(item => !item.includes("Signature Portal"))
    }
  };
  const result = run([file], missingPortalLink);
  assert.equal(result.ok, false);
  assert.match(result.reason, /portal-specific real-run smoke links/);
});
