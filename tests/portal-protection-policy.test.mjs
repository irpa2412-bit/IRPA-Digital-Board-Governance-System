import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy, parseActivityTimestamps, parseGitHubJobEvidence, newPortalWarningUntil, portalPolicyPaths, resolvePortalPolicyPaths } from "../scripts/portal-protection-check.mjs";
import fs from "node:fs";
const registry = JSON.parse(fs.readFileSync(new URL("../docs/portal-protection/portal-register.json", import.meta.url), "utf8"));

const portal = "Signature Portal";
const now = Date.parse("2026-11-19T20:00:00Z");
const file = "src/pages/SignaturePlatform.jsx";
const valid = {
  status: "complete",
  declaration: { affectedPortals: [portal], files: [file], baseline: { commit: "433727282012c75cdaebca21dcdadcb28dba59fb", rollbackCommit: "433727282012c75cdaebca21dcdadcb28dba59fb" } },
  validation: {
    baselineSmoke: "PASS",
    fullRegression: "PASS",
    portalSmoke: { [portal]: "PASS" },
    evidence: [
      "Baseline smoke PASS for 433727282012c75cdaebca21dcdadcb28dba59fb https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/1/job/11",
      "Full regression PASS for 433727282012c75cdaebca21dcdadcb28dba59fb https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/1/job/12",
      "Signature Portal portal smoke PASS for 433727282012c75cdaebca21dcdadcb28dba59fb https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/1/job/13"
    ],
    behaviourDifferences: []
  }
};
const windowState = { status: "open", openedAt: "2026-11-19T18:00:00Z", expiresAt: "2026-11-22T18:00:00Z", durationHours: 72, scope: [file] };
const run = (changedFiles, record = valid, win = windowState, activity = "2026-11-19T19:59:00Z") =>
  evaluatePolicy({ changedFiles, registry, record, windowState: win, latestActivityAt: activity, now });

test("protected change without Change Record fails", () => assert.equal(run([file], null).ok, false));
test("valid record and active scoped window pass", () => assert.equal(run([file]).ok, true));
test("active amendment file declarations extend the original change record", () => {
  const amended = { ...valid, declaration: { ...valid.declaration, files: [] }, activeAmendment: { files: [file] } };
  assert.equal(run([file], amended).ok, true);
});
test("72-hour inactivity closes the window", () => assert.equal(run([file], valid, windowState, "2026-11-18T19:59:00Z").ok, false));
test("out-of-scope protected change fails", () => assert.equal(run([file], valid, { ...windowState, scope: ["src/pages/Invitations.jsx"] }).ok, false));
test("multi-portal shared dependency changes fail even with a complete shared record", () => {
  const result = run(["src/App.jsx"], { ...valid, declaration: { ...valid.declaration, affectedPortals: Object.keys(registry.portals), files: ["src/App.jsx"] }, validation: { ...valid.validation, portalSmoke: Object.fromEntries(Object.keys(registry.portals).map(p => [p, "PASS"])) } }, { ...windowState, scope: ["src/App.jsx"] });
  assert.equal(result.affected.length, 7);
  assert.equal(result.ok, false);
  assert.match(result.reason, /one-portal PRs/);
});
test("unrelated change passes without a repair window", () => assert.equal(run(["README.md"], null, null).ok, true));

test("a new commit cannot silently reopen a window after a 24-hour gap", () => {
  const result = evaluatePolicy({ changedFiles: [file], registry, record: valid, windowState, activityTimestamps: ["2026-11-19T18:30:00Z", "2026-11-22T19:00:00Z"], now: Date.parse("2026-11-22T19:01:00Z") });
  assert.equal(result.ok, false);
});
test("a fresh declaration reopens after an earlier closure", () => {
  const reopened = { ...windowState, openedAt: "2026-11-20T18:00:00Z", expiresAt: "2026-11-23T18:00:00Z" };
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
test("shared or multi-portal changes are rejected rather than selecting a shared record", () => {
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

test("72-hour expiry is mandatory and an expired window fails", () => {
  const expired = { ...windowState, expiresAt: "2026-11-22T17:59:59Z" };
  const result = evaluatePolicy({ changedFiles: [file], registry, record: valid, windowState: expired, latestActivityAt: "2026-11-22T17:00:00Z", now: Date.parse("2026-11-22T18:00:00Z") });
  assert.equal(result.ok, false);
  assert.match(result.reason, /72-hour/);
});

test("warning is emitted below 12 hours remaining without bypassing other checks", () => {
  const result = evaluatePolicy({ changedFiles: [file], registry, record: valid, windowState, latestActivityAt: "2026-11-22T06:00:00Z", now: Date.parse("2026-11-22T07:00:00Z") });
  assert.equal(result.ok, true);
  assert.match(result.warning, /less than 12 hours/);
});

test("break-glass expires after 24 hours even though repair windows last 72 hours", () => {
  const emergency = { ...windowState, emergency: true, emergencyExpiresAt: "2026-11-20T18:00:00Z" };
  const result = evaluatePolicy({ changedFiles: [file], registry, record: valid, windowState: emergency, latestActivityAt: "2026-11-20T17:00:00Z", now: Date.parse("2026-11-20T18:00:01Z") });
  assert.equal(result.ok, false);
  assert.match(result.reason, /24-hour break-glass/);
});

test("a portal's per-portal record paths are unique and cannot approve another portal", () => {
  const names = Object.keys(registry.portals);
  const paths = names.map(name => portalPolicyPaths([name]));
  assert.equal(new Set(paths.map(value => value.windowPath)).size, names.length);
  assert.equal(new Set(paths.map(value => value.recordPath)).size, names.length);
  const meeting = portalPolicyPaths(["Meeting Portal"]);
  const signature = portalPolicyPaths(["Signature Portal"]);
  assert.notEqual(meeting.windowPath, signature.windowPath);
  assert.notEqual(meeting.recordPath, signature.recordPath);
});

test("new portals receive a seven-day warning period and then require full protection files", () => {
  const entry = { guardMode: "warning", registeredAt: "2026-11-22T00:00:00Z" };
  const until = newPortalWarningUntil(entry);
  assert.equal(until, Date.parse("2026-11-29T00:00:00Z"));
  assert.equal(newPortalWarningUntil({ guardMode: "protected", registeredAt: entry.registeredAt }), null);
  assert.equal(until - Date.parse(entry.registeredAt), 7 * 24 * 60 * 60 * 1000);
});

test("real evidence URLs must identify an exact repository, run and job", () => {
  assert.deepEqual(parseGitHubJobEvidence("Baseline smoke PASS https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44952176019/job/136992981056"), {
    repository: "irpa2412-bit/IRPA-Digital-Board-Governance-System", runId: 44952176019, jobId: 136992981056
  });
  assert.equal(parseGitHubJobEvidence("https://example.com/not-a-run"), null);
});
