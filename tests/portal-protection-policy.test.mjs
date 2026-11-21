import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy, parseActivityTimestamps } from "../scripts/portal-protection-check.mjs";
import fs from "node:fs";
const registry = JSON.parse(fs.readFileSync(new URL("../docs/portal-protection/portal-register.json", import.meta.url), "utf8"));

const portal = "Signature Portal";
const now = Date.parse("2026-11-19T20:00:00Z");
const file = "src/pages/SignaturePlatform.jsx";
const valid = {
  status: "complete",
  declaration: { affectedPortals: [portal, "Meeting Portal"], reason: "Repair", files: [file], expectedEffect: "Fix scoped defect", prohibitedChanges: ["No signing rule changes"] },
  baseline: { commit: "433727282012c75cdaebca21dcdadcb28dba59fb", rollbackCommit: "433727282012c75cdaebca21dcdadcb28dba59fb" },
  validation: { baselineSmoke: "PASS", fullRegression: "PASS", portalSmoke: { [portal]: "PASS", "Meeting Portal": "PASS" }, behaviourDifferences: [] }
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
test("shared dependency fans out to every dependent portal", () => {
  const result = run(["src/App.jsx"], { ...valid, declaration: { ...valid.declaration, affectedPortals: Object.keys(registry.portals), files: ["src/App.jsx"] }, validation: { ...valid.validation, portalSmoke: Object.fromEntries(Object.keys(registry.portals).map(p => [p, "PASS"])) } }, { ...windowState, scope: ["src/App.jsx"] });
  assert.equal(result.affected.length, 7);
  assert.equal(result.ok, true);
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


const meetingFile = "drive-gateway/src/meetingServices.mjs";
const meetingAmendmentRecord = {
  ...valid,
  meetingAmendment: {
    status: "open",
    affectedPortals: ["Meeting Portal"],
    reason: "Protect REAL meetings and allow only administrator deletion of explicit TRIAL meetings.",
    expectedEffect: "Missing and invalid environment values fail closed as REAL; environment is immutable after creation.",
    prohibitedChanges: ["Do not delete REAL meetings.", "Do not change signing or voting rules."],
    files: [meetingFile],
    baseline: { commit: "352d8b36718a3b88173934c607e6c7834f72a71b", rollbackCommit: "352d8b36718a3b88173934c607e6c7834f72a71b" },
    validation: {
      baselineSmoke: "PASS",
      fullRegression: "PASS",
      portalSmoke: { "Meeting Portal": "PASS" },
      behaviourDifferences: ["Only explicit TRIAL meetings are deletable."],
      evidence: ["https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44897446474"]
    }
  }
};
const meetingWindow = {
  ...windowState,
  reopenedAt: "2026-11-21T20:00:00Z",
  scope: [meetingFile]
};

test("Meeting Portal amendment uses its own passing validation without rewriting Signature Portal history", () => {
  const result = evaluatePolicy({
    changedFiles: [meetingFile],
    record: meetingAmendmentRecord,
    windowState: meetingWindow,
    latestActivityAt: "2026-11-21T20:01:00Z",
    now: Date.parse("2026-11-21T20:02:00Z")
  });
  assert.equal(result.ok, true);
});

test("Meeting Portal amendment fails without its own passing portal smoke evidence", () => {
  const record = structuredClone(meetingAmendmentRecord);
  record.meetingAmendment.validation.portalSmoke = {};
  const result = evaluatePolicy({
    changedFiles: [meetingFile],
    record,
    windowState: meetingWindow,
    latestActivityAt: "2026-11-21T20:01:00Z",
    now: Date.parse("2026-11-21T20:02:00Z")
  });
  assert.equal(result.ok, false);
});
