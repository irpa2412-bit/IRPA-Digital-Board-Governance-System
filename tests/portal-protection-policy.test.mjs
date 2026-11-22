import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy, parseActivityTimestamps, parseGitHubJobEvidence, newPortalWarningUntil, portalPolicyPaths, resolvePortalPolicyPaths, classifyProtectionOnlyChange, MAINTENANCE_APPROVAL_QUOTE } from "../scripts/portal-protection-check.mjs";
import fs from "node:fs";
const registry = JSON.parse(fs.readFileSync(new URL("../docs/portal-protection/portal-register.json", import.meta.url), "utf8"));

const portal = "Signature Portal";
const now = Date.parse("2026-11-19T20:00:00Z");
const file = "src/pages/SignaturePlatform.jsx";
const valid = {
  status: "complete",
  declaration: { affectedPortals: [portal], files: [file], reason: "controlled portal repair", expectedEffect: "preserve protected behavior", prohibitedChanges: ["no unrelated portal source"], baseline: { commit: "433727282012c75cdaebca21dcdadcb28dba59fb", rollbackCommit: "433727282012c75cdaebca21dcdadcb28dba59fb" } },
  baseline: { commit: "433727282012c75cdaebca21dcdadcb28dba59fb", rollbackCommit: "433727282012c75cdaebca21dcdadcb28dba59fb" },
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
const sharedPath = "src/pages/SignaturePlatform.jsx";
const sharedOwners = ["Signature Portal", "Meeting Portal"];
const sharedOwnerPolicies = () => Object.fromEntries(sharedOwners.map((owner, index) => {
  const baselineCommit = "433727282012c75cdaebca21dcdadcb28dba59fb";
  const record = {
    status: "complete",
    declaration: {
      affectedPortals: [owner], files: [sharedPath],
      reason: "shared dependency maintenance",
      expectedEffect: "preserve both owning portals",
      prohibitedChanges: ["no portal-specific source changes"]
    },
    baseline: { commit: baselineCommit, rollbackCommit: baselineCommit },
    validation: {
      baselineSmoke: "PASS", fullRegression: "PASS",
      portalSmoke: { [owner]: "PASS" },
      evidence: [
        `Baseline smoke PASS for ${baselineCommit} https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/1/job/11`,
        `Full regression PASS for ${baselineCommit} https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/1/job/12`,
        `${owner} portal smoke PASS for ${baselineCommit} https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/1/job/${13 + index}`
      ],
      behaviourDifferences: []
    }
  };
  return [owner, {
    record,
    windowState: {
      status: "open", openedAt: "2026-11-19T18:00:00Z",
      expiresAt: "2026-11-22T18:00:00Z", durationHours: 72,
      scope: [sharedPath]
    },
    activityTimestamps: ["2026-11-19T19:59:00Z"]
  }];
}));

test("shared file is classified once and requires each owning portal's independent protection", () => {
  const result = evaluatePolicy({
    changedFiles: [sharedPath],
    registry,
    ownerPolicies: sharedOwnerPolicies(),
    now
  });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.affected, sharedOwners);
  assert.deepEqual(result.sharedFiles, [sharedPath]);
  assert.equal(result.ownerResults.length, 2);
  assert.ok(result.ownerResults.every(owner => owner.lockTests.length > 0));
});

test("shared-file change fails when one owner's window or baseline evidence is missing", () => {
  const missingWindow = sharedOwnerPolicies();
  delete missingWindow["Meeting Portal"].windowState;
  const windowResult = evaluatePolicy({ changedFiles: [sharedPath], registry, ownerPolicies: missingWindow, now });
  assert.equal(windowResult.ok, false);
  assert.match(windowResult.reason, /Meeting Portal/);

  const missingEvidence = sharedOwnerPolicies();
  missingEvidence["Meeting Portal"].record.validation.evidence =
    missingEvidence["Meeting Portal"].record.validation.evidence.filter(item => !item.includes("Meeting Portal portal smoke"));
  const evidenceResult = evaluatePolicy({ changedFiles: [sharedPath], registry, ownerPolicies: missingEvidence, now });
  assert.equal(evidenceResult.ok, false);
  assert.match(evidenceResult.reason, /Meeting Portal/);
});

test("shared-file change cannot include portal-specific source from another owner", () => {
  const result = evaluatePolicy({
    changedFiles: [sharedPath, "src/pages/Meetings.jsx"],
    registry,
    ownerPolicies: sharedOwnerPolicies(),
    now
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /cannot be combined with portal-specific source changes/);
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

const ownerApproval = {
  authorLogin: "irpa2412-bit",
  ownerLogin: "irpa2412-bit",
  body: MAINTENANCE_APPROVAL_QUOTE
};
const sevenPortalProtectionFiles = Object.keys(registry.portals).map(name => {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `docs/portal-protection/windows/${slug}.json`;
});

test("shared register entries carry the explicit shared class", () => {
  assert.ok(registry.shared.length > 0);
  assert.ok(registry.shared.every(entry => entry.class === "shared"));
  assert.ok(registry.shared.some(entry =>
    entry.path === "src/pages/SignaturePlatform.jsx" &&
    entry.portals.includes("Signature Portal") &&
    entry.portals.includes("Meeting Portal")
  ));
});

test("seven-portal protection-only maintenance passes classification with quoted owner approval", () => {
  const result = classifyProtectionOnlyChange(sevenPortalProtectionFiles, ownerApproval);
  assert.equal(result.eligible, true);
  assert.equal(result.ownerApproved, true);
  assert.equal(result.ok, true);
});

test("the same seven-portal protection-only maintenance fails without owner approval", () => {
  const result = classifyProtectionOnlyChange(sevenPortalProtectionFiles, null);
  assert.equal(result.eligible, true);
  assert.equal(result.ownerApproved, false);
  assert.equal(result.ok, false);
  assert.match(result.reason, /repository owner account/);
});

test("two portals' source files fail even when the owner approval is present", () => {
  const changed = ["src/pages/Invitations.jsx", "src/pages/GrantIntelligencePortal.jsx"];
  const classification = classifyProtectionOnlyChange(changed, ownerApproval);
  assert.equal(classification.eligible, false);
  const result = evaluatePolicy({ changedFiles: changed, registry, record: valid, windowState });
  assert.equal(result.ok, false);
  assert.match(result.reason, /multi-portal changes are blocked/);
});

test("a protection file for one portal mixed with another portal's source fails even with approval", () => {
  const changed = [
    "docs/portal-protection/windows/invitation-portal.json",
    "src/pages/GrantIntelligencePortal.jsx"
  ];
  const classification = classifyProtectionOnlyChange(changed, ownerApproval);
  assert.equal(classification.eligible, false);
  const result = evaluatePolicy({ changedFiles: changed, registry, record: valid, windowState });
  assert.equal(result.ok, false);
  assert.match(result.reason, /multi-portal changes are blocked/);
});
