import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/meeting-portal-fixture-browser.yml", import.meta.url), "utf8");
const guard = readFileSync(new URL("../scripts/meeting-portal-fixture-isolation-guard.sh", import.meta.url), "utf8");
const policy = readFileSync(new URL("../scripts/portal-repair-window-guard-policy.mjs", import.meta.url), "utf8");

test("isolation baseline compares against the fetched current main snapshot", () => {
  assert.match(guard, /git fetch origin main:refs\/remotes\/origin\/main/);
  assert.match(guard, /const eventName = process\.env\.EVENT_NAME\?\.trim\(\)/);
  assert.match(guard, /const base = "origin\/main"/);
  assert.ok(guard.includes('git", ["diff", "--name-only", `${base}...HEAD`]'));
});

test("Wrangler changes cannot alter production configuration", () => {
  assert.match(guard, /if \(changed\.includes\(wranglerPath\)\)/);
  assert.match(guard, /productionSection\(baselineConfig, "Baseline Wrangler config"\) !== productionSection\(currentConfig, "Current Wrangler config"\)/);
  assert.match(guard, /Production Wrangler configuration changed; only staging-only changes are permitted/);
});

test("staging keeps its dedicated KV namespace and rejects the production namespace", () => {
  assert.match(guard, /id = "5ea76010553049a2b98c8493c37fbbc4"/);
  assert.match(guard, /id = "ccdbffa662ac48bfbdf7f4b1f62ca941"/);
  assert.match(guard, /Staging DRIVE_KV must retain the explicitly approved dedicated namespace/);
  assert.match(guard, /Production DRIVE_KV cannot be used by staging/);
});

test("workflow-only guard maintenance requires its paired regression test", () => {
  assert.match(guard, /const guardOnlyWorkflowRepair = changed\.includes\("\.github\/workflows\/meeting-portal-fixture-browser\.yml"\)/);
  assert.match(guard, /changed\.includes\("tests\/meeting-isolation-guard\.test\.mjs"\)/);
  assert.match(guard, /!guardOnlyWorkflowRepair/);
});

test("invitation resend regression is explicitly allowlisted by the isolation guard", () => {
  assert.ok(guard.includes('"tests/meeting-invitation-resend-quorum.test.mjs"'));
});

test("invitation/reset integration exception requires all paired implementation and test files", () => {
  assert.match(guard, /const invitationMailResendIntegration = changed\.includes\("public\/administrator\.html"\)/);
  for (const path of [
    "public/administrator.html",
    "src/firebase/auth.js",
    "src/pages/Invitations.jsx",
    "drive-gateway/src/index.js",
    "drive-gateway/src/invitationEmail.mjs",
    "drive-gateway/tests/mail-invitation.unit.mjs",
  ]) {
    assert.ok(guard.includes(`"${path}"`), `missing required paired path: ${path}`);
  }
  assert.match(guard, /changed\.every\(path => allowed\.has\(path\)\)/);
  assert.match(guard, /!invitationMailResendIntegration/);
});

test("Signature Gateway integration must include its portal bridge and authenticated flow test", () => {
  assert.match(guard, /const signatureGatewayIntegration = changed\.includes\("src\/firebase\/signaturePlatform\.js"\)/);
  assert.match(guard, /changed\.includes\("drive-gateway\/src\/signing\.mjs"\)/);
  assert.match(guard, /changed\.includes\("drive-gateway\/tests\/controlled-authenticated-signing-flow\.test\.mjs"\)/);
  assert.match(guard, /!signatureGatewayIntegration/);
});

test("Signature Gateway isolation does not exempt unrelated staging admin reset workflows", () => {
  assert.match(guard, /!allowed\.has\(path\).*signatureGatewayIntegration/);
  assert.doesNotMatch(guard, /staging-admin-reset-fixture\.yml/);
});

test("Communication and Media archive gateway integration is explicitly isolated and allowlisted", () => {
  assert.match(guard, /const communicationMediaArchiveIntegration =/);
  assert.match(guard, /changed\.includes\("src\/pages\/CommunicationMediaStudio\.jsx"\)/);
  assert.match(guard, /changed\.includes\("tests\/communication-media-policy\.test\.mjs"\)/);
  assert.match(guard, /changed\.includes\("drive-gateway\/src\/index\.js"\)/);
  assert.match(guard, /changed\.includes\("drive-gateway\/wrangler\.toml"\)/);
  assert.match(guard, /"drive-gateway\/tests\/staging-isolation\.test\.mjs"/);
  assert.match(guard, /"firestore\.rules"/);
  assert.match(guard, /changed\.includes\("src\/firebase\/signatureStorage\.js"\)/);
  assert.match(guard, /changed\.includes\("docs\/COMMUNICATION_MEDIA_PORTAL\.md"\)/);
  assert.match(guard, /!changed\.includes\("src\/pages\/Meetings\.jsx"\)/);
  assert.match(guard, /!changed\.includes\("src\/pages\/OperationalGatewaysParticipants\.jsx"\)/);
  assert.match(guard, /communicationMediaArchiveIntegration && communicationMediaArchivePaths\.has\(path\)/);
});

test("readability-only PRs are narrowly allowlisted without permitting unrelated portal source changes", () => {
  assert.match(guard, /const readabilityOnlyFiles = new Set\(\[/);
  assert.ok(guard.includes('"--name-only", `${base}...HEAD`'));
  assert.match(guard, /changed\.includes\("src\/styles\/portal-readability-standard\.css"\)/);
  assert.match(guard, /changed\.every\(path => readabilityOnlyFiles\.has\(path\)\)/);
  assert.match(guard, /!readabilityOnlyChange/);
  assert.match(guard, /"src\/App\.jsx"/);
  assert.match(guard, /"tests\/browser\/authenticated-governance-regression\.spec\.mjs"/);
});

test("controlled-document trial upload permission fix must remain paired with Firestore rule regression tests", () => {
  assert.match(guard, /const controlledDocumentTrialUploadFix = changed\.includes\("firestore\.rules"\)/);
  assert.match(guard, /changed\.includes\("tests\/firestore\.rules\.test\.cjs"\)/);
  assert.match(guard, /!controlledDocumentTrialUploadFix/);
});

test("PDF palette repair is isolated to the signature page, scoped storage helper and paired policy test", () => {
  assert.match(guard, /const signaturePdfPaletteRepair = changed\.includes\("src\/pages\/SignaturePlatform\.jsx"\)/);
  assert.match(guard, /changed\.includes\("src\/firebase\/signatureStorage\.js"\)/);
  assert.match(guard, /changed\.includes\("tests\/signature-workflow-policy\.test\.mjs"\)/);
  assert.match(guard, /!signaturePdfPaletteRepair/);
  assert.match(guard, /changed\.every\(path => \["\.github\/workflows\/meeting-portal-fixture-browser\.yml", "tests\/meeting-isolation-guard\.test\.mjs", "src\/pages\/SignaturePlatform\.jsx", "src\/firebase\/signatureStorage\.js", "tests\/signature-workflow-policy\.test\.mjs"\]\.includes\(path\)\)/);
});


test("PDF URL handoff repair is narrowly paired with its policy regression test", () => {
  assert.match(guard, /const signaturePdfUrlHandoffRepair = changed\.includes\("src\/pages\/SignaturePlatform\.jsx"\)/);
  assert.match(guard, /changed\.includes\("tests\/signature-workflow-policy\.test\.mjs"\)/);
  assert.match(guard, /!signaturePdfUrlHandoffRepair/);
  assert.match(guard, /changed\.every\(path => \["\.github\/workflows\/meeting-portal-fixture-browser\.yml", "tests\/meeting-isolation-guard\.test\.mjs", "src\/pages\/SignaturePlatform\.jsx", "tests\/signature-workflow-policy\.test\.mjs"\]\.includes\(path\)\)/);
});


test("selected signer list visibility fix is narrowly paired with its regression test", () => {
  assert.match(guard, /const signatureSignerListVisibilityRepair = changed\.includes\("src\/pages\/SignaturePlatform\.jsx"\)/);
  assert.match(guard, /changed\.includes\("tests\/signature-signer-picker-regression\.test\.mjs"\)/);
  assert.match(guard, /!signatureSignerListVisibilityRepair/);
  assert.match(guard, /changed\.every\(path => \["\.github\/workflows\/meeting-portal-fixture-browser\.yml", "tests\/meeting-isolation-guard\.test\.mjs", "src\/pages\/SignaturePlatform\.jsx", "tests\/signature-signer-picker-regression\.test\.mjs"\]\.includes\(path\)\)/);
});


test("Signature document palette and assignment repair is narrowly paired with access-rule tests", () => {
  assert.match(guard, /const signatureDocumentPaletteAssignmentRepair = changed\.includes\("src\/pages\/SignaturePlatform\.jsx"\)/);
  assert.match(guard, /changed\.includes\("src\/firebase\/data\.js"\)/);
  assert.match(guard, /changed\.includes\("firestore\.rules"\)/);
  assert.match(guard, /changed\.includes\("tests\/firestore\.rules\.test\.cjs"\)/);
  assert.match(guard, /!signatureDocumentPaletteAssignmentRepair/);
  assert.match(guard, /!signatureDocumentPaletteAssignmentRepair && !signaturePaletteLifecycleSourceRepair && !signaturePdfArchivePaletteRepair && !signatureEmailLinkIdentityRepair && !guardOnlyWorkflowRepair/);
});


test("Signature palette lifecycle source repair is paired with regression coverage", () => {
  assert.match(guard, /const signaturePaletteLifecycleSourceRepair = changed\.includes\("src\/firebase\/data\.js"\)/);
  assert.match(guard, /changed\.includes\("tests\/signature-workflow-policy\.test\.mjs"\)/);
  assert.match(guard, /!signatureDocumentPaletteAssignmentRepair && !signaturePaletteLifecycleSourceRepair && !signaturePdfArchivePaletteRepair && !signatureEmailLinkIdentityRepair && !guardOnlyWorkflowRepair/);
});


test("archive-backed Signature Portal PDF palette repair is explicitly paired and path-limited", () => {
  assert.match(guard, /const signaturePdfArchivePaletteRepair = changed\.includes\("src\/firebase\/data\.js"\)/);
  assert.match(guard, /changed\.includes\("src\/pages\/SignaturePlatform\.jsx"\)/);
  assert.match(guard, /changed\.includes\("tests\/signature-workflow-policy\.test\.mjs"\)/);
  assert.match(guard, /!signaturePdfArchivePaletteRepair/);
  assert.match(guard, /changed\.every\(path => \["\.github\/workflows\/meeting-portal-fixture-browser\.yml", "tests\/meeting-isolation-guard\.test\.mjs", "src\/firebase\/data\.js", "src\/pages\/SignaturePlatform\.jsx", "tests\/signature-workflow-policy\.test\.mjs"\]\.includes\(path\)\)/);
});

test("source-isolation guard accepts the protected main push path without requiring a PR diff", () => {
  assert.doesNotMatch(workflow, /^\\s*push:/m);
  assert.match(guard, /const isMainPush = eventName === "push" && process\.env\.GITHUB_REF === "refs\/heads\/main"/);
  assert.match(guard, /if \(!isMainPush && eventName !== "workflow_dispatch"/);
});


test("touch-responsive signature palette assignment is narrowly allowlisted with its paired policy test", () => {
  assert.match(guard, /const signaturePaletteDirectAssignmentRepair =/);
  assert.match(guard, /changed\.includes\("src\/pages\/SignaturePlatform\.jsx"\)/);
  assert.match(guard, /changed\.includes\("src\/styles\/signature-portal\.css"\)/);
  assert.match(guard, /changed\.includes\("tests\/signature-workflow-policy\.test\.mjs"\)/);
  assert.match(guard, /changed\.includes\("tests\/signature-palette-signer-management\.test\.mjs"\)/);
  assert.match(guard, /changed\.includes\("tests\/signature-signer-picker-regression\.test\.mjs"\)/);
  assert.match(guard, /!signaturePaletteDirectAssignmentRepair/);
  assert.match(guard, /signaturePaletteDirectAssignmentRepair &&/);
  assert.ok(guard.includes('"src/styles/signature-portal.css"'));
});

test("Meeting Portal fixture runs on every repair branch and all Meeting Portal source paths", () => {
  assert.doesNotMatch(workflow, /^\\s*push:/m);
  for (const path of [
    "docs/portal-protection/repair-window.json",
    "src/pages/MeetingRoom.jsx",
    "src/firebase/meetingAttendanceSigning.js",
    "src/firebase/meetingAttendanceSignerIdentity.js",
    "drive-gateway/src/meetingServices.mjs",
    "tests/meeting-daily-attendance-email-signing.test.mjs",
    "tests/meeting-attendance-guest-identity.test.mjs",
    "tests/meeting-time-eat.test.mjs",
    "tests/meeting-registration-connectivity.test.mjs",
    "tests/meeting-configurable-quorum.test.mjs",
    "tests/fixtures/**",
    "vite.meeting-fixture.config.js"
  ]) assert.ok(workflow.includes(`"${path}"`), `missing fixture trigger: ${path}`);
  assert.ok(guard.includes("const allowed = new Set(["));
  assert.ok(guard.includes('"drive-gateway/src/meetingServices.mjs"'));
  assert.ok(guard.includes('"src/firebase/meetingAttendanceSigning.js"'));
});

test("workflow delegates its source-isolation gate to the extracted guard script", () => {
  assert.match(workflow, /run: bash scripts\/meeting-portal-fixture-isolation-guard\.sh/);
  assert.ok(guard.includes('"scripts/meeting-portal-fixture-isolation-guard.sh"'));
  assert.ok(guard.includes('"docs/portal-protection/repair-window.json"'));
});

test("only stale runs for the same pull request are cancelled", () => {
  assert.ok(workflow.includes("group: meeting-portal-browser-${{ github.event.pull_request.number || github.ref }}"));
  assert.ok(workflow.includes("cancel-in-progress: true"));
  assert.doesNotMatch(workflow, /^\\s*push:/m);
});

test("parallel portal window amendments preserve existing meeting and historical change records", () => {
  assert.ok(guard.includes('"docs/portal-protection/change-record.json"'));
  assert.match(guard, /delete baselineRecord\.activeAmendment/);
  assert.match(guard, /delete currentRecord\.activeAmendment/);
  assert.match(guard, /Parallel repair-window amendment changed existing change-record history or another portal's record/);
});

test("parallel portal window amendment delegates to the executable exact-scope policy", () => {
  assert.match(guard, /evaluateSignatureWindowAmendment/);
  assert.ok(guard.includes('"scripts/portal-repair-window-guard-policy.mjs"'));
  assert.match(guard, /evaluateSignatureWindowClosure/);
  assert.match(guard, /parallelWindowDecision\.pass \|\| signatureWindowClosureDecision\.pass/);
  assert.match(guard, /evaluateSignatureWindowReopen/);
  assert.match(guard, /signatureWindowClosureDecision\.pass \|\| signatureWindowReopenDecision\.pass/);
  assert.match(guard, /if \(!parallelWindowRecordAmendment\) throw new Error\(signatureWindowReopenDecision\.reason \|\| signatureWindowClosureDecision\.reason \|\| parallelWindowDecision\.reason\)/);
});


import {
  evaluateSignatureWindowAmendment,
  evaluateSignatureWindowRepair,
  evaluateSignatureWindowClosure,
  evaluateSignatureWindowReopen,
  SIGNATURE_WINDOW_AMENDMENT_PATHS
} from "../scripts/portal-repair-window-guard-policy.mjs";

const isolatedWindowFixture = () => {
  const activeAmendment = {
    status: "open",
    files: ["drive-gateway/src/signing.mjs", "drive-gateway/src/emailSigningLinks.mjs"],
    repairWindow: { rollbackCommit: "eb04405e4ec2d64e45d016b6ed3adbc2e8136fbd" }
  };
  const baselineChangeRecord = { status: "complete", repairWindow: { status: "open", portal: "Meeting Portal" }, history: [{ action: "meeting-window-opened" }] };
  const currentChangeRecord = { ...structuredClone(baselineChangeRecord), activeAmendment };
  const repairWindow = {
    parallelWindows: [{
      portal: "Signature Portal",
      status: "open",
      closesAt: "2026-11-22T17:08:47Z",
      rollbackCommit: "eb04405e4ec2d64e45d016b6ed3adbc2e8136fbd"
    }]
  };
  return { changedPaths: [...SIGNATURE_WINDOW_AMENDMENT_PATHS], repairWindow, changeRecord: { activeAmendment }, baselineChangeRecord, currentChangeRecord };
};

test("isolation guard blocks a change outside the Signature Portal window files", () => {
  const fixture = isolatedWindowFixture();
  fixture.changedPaths.push("src/pages/Meetings.jsx");
  assert.equal(evaluateSignatureWindowAmendment({ ...fixture, now: new Date("2026-11-20T18:00:00Z") }).pass, false);
});

test("isolation guard blocks an expired Signature Portal repair window", () => {
  const fixture = isolatedWindowFixture();
  assert.equal(evaluateSignatureWindowAmendment({ ...fixture, now: new Date("2026-11-23T00:00:00Z") }).pass, false);
});

test("isolation guard blocks protected-file changes when no active Change Record exists", () => {
  const fixture = isolatedWindowFixture();
  fixture.changeRecord = {};
  assert.equal(evaluateSignatureWindowAmendment({ ...fixture, now: new Date("2026-11-20T18:00:00Z") }).pass, false);
});

test("isolation guard blocks edits to another portal window or existing history", () => {
  const fixture = isolatedWindowFixture();
  fixture.currentChangeRecord.repairWindow.status = "closed";
  assert.equal(evaluateSignatureWindowAmendment({ ...fixture, now: new Date("2026-11-20T18:00:00Z") }).pass, false);
});

test("isolation guard permits only the separate unexpired Signature Portal window amendment", () => {
  const fixture = isolatedWindowFixture();
  assert.equal(evaluateSignatureWindowAmendment({ ...fixture, now: new Date("2026-11-20T18:00:00Z") }).pass, true);
});


const signatureRepairFixture = () => {
  const changedPaths = [
    "drive-gateway/src/emailSigning/index.mjs", "drive-gateway/src/signing.mjs",
    "drive-gateway/src/router.mjs", "drive-gateway/src/index.js",
    "src/pages/EmailSigningReadOnlyPage.jsx", "src/pages/SignaturePlatform.jsx",
    "drive-gateway/tests/email-signing-contract.test.mjs", ".github/workflows/email-signing-contract.yml",
    "drive-gateway/tests/email-signing-links.integration.test.mjs",
    "drive-gateway/tests/email-signing-links.release-contract.test.mjs",
    "drive-gateway/tests/email-signing-links.test.mjs",
    "drive-gateway/tests/gate5-document-signature-persistence.test.mjs",
    "drive-gateway/tests/signature-field-assignment-regression.test.mjs",
    "drive-gateway/tests/signing-invitation.test.mjs",
    "tests/signature-email-link-unification.test.mjs", "tests/signature-workflow-policy.test.mjs"
  ];
  const baselineChangeRecord = { status: "complete", repairWindow: { portal: "Meeting Portal", status: "open" }, history: [{ action: "meeting-baseline" }] };
  const currentChangeRecord = {
    ...structuredClone(baselineChangeRecord),
    activeAmendment: {
      status: "open",
      operation: "restore-pre-11-eat-baseline",
      files: [
        "drive-gateway/src/emailSigning/index.mjs", "drive-gateway/src/signing.mjs",
        "drive-gateway/src/router.mjs", "drive-gateway/src/index.js",
        "src/pages/EmailSigningReadOnlyPage.jsx", "src/pages/SignaturePlatform.jsx",
        "drive-gateway/tests/email-signing-contract.test.mjs", ".github/workflows/email-signing-contract.yml",
        "drive-gateway/tests/email-signing-links.integration.test.mjs",
        "drive-gateway/tests/email-signing-links.release-contract.test.mjs",
        "drive-gateway/tests/email-signing-links.test.mjs",
        "drive-gateway/tests/gate5-document-signature-persistence.test.mjs",
        "drive-gateway/tests/signature-field-assignment-regression.test.mjs",
        "drive-gateway/tests/signing-invitation.test.mjs",
        "tests/signature-email-link-unification.test.mjs", "tests/signature-workflow-policy.test.mjs"
      ],
      repairWindow: { rollbackCommit: "eb04405e4ec2d64e45d016b6ed3adbc2e8136fbd" }
    }
  };
  const repairWindow = { parallelWindows: [{ portal: "Signature Portal", status: "open", closesAt: "2026-11-22T17:08:47Z", rollbackCommit: "eb04405e4ec2d64e45d016b6ed3adbc2e8136fbd" }] };
  return { changedPaths, repairWindow, changeRecord: currentChangeRecord, baselineChangeRecord, currentChangeRecord };
};

test("active Signature Portal repair guard permits only declared repair files plus guard-maintenance tests", () => {
  const fixture = signatureRepairFixture();
  assert.equal(evaluateSignatureWindowRepair({ ...fixture, now: new Date("2026-11-20T18:00:00Z") }).pass, true);
});

test("active Signature Portal repair guard blocks files outside the declared window", () => {
  const fixture = signatureRepairFixture();
  fixture.changedPaths.push("src/pages/Meetings.jsx");
  assert.equal(evaluateSignatureWindowRepair({ ...fixture, now: new Date("2026-11-20T18:00:00Z") }).pass, false);
});

test("active Signature Portal repair guard blocks an expired window", () => {
  const fixture = signatureRepairFixture();
  assert.equal(evaluateSignatureWindowRepair({ ...fixture, now: new Date("2026-11-23T00:00:00Z") }).pass, false);
});

test("active Signature Portal repair guard blocks protected files without a Change Record", () => {
  const fixture = signatureRepairFixture();
  fixture.changeRecord = {};
  assert.equal(evaluateSignatureWindowRepair({ ...fixture, now: new Date("2026-11-20T18:00:00Z") }).pass, false);
});

test("active Signature Portal repair guard blocks changes to another portal's window or history", () => {
  const fixture = signatureRepairFixture();
  fixture.currentChangeRecord.repairWindow.status = "closed";
  assert.equal(evaluateSignatureWindowRepair({ ...fixture, now: new Date("2026-11-20T18:00:00Z") }).pass, false);
});


test("email-signing rebuild is explicitly protected by the active Signature Portal window", () => {
  assert.ok(guard.includes("const emailSigningRebuildIntegration ="));
  assert.ok(guard.includes('path.startsWith("drive-gateway/src/emailSigning/")'));
  assert.ok(guard.includes('"src/pages/SignaturePlatform.jsx"'));
  assert.ok(guard.includes("email-signing-contract.test.mjs"));
  assert.ok(policy.includes('path.startsWith("drive-gateway/src/emailSigning/")'));
  assert.ok(policy.includes('"src/pages/SignaturePlatform.jsx"'));
});


const closureFixture = () => {
  const baselineSignature = {
    portal: "Signature Portal", status: "open",
    openedAt: "2026-11-20T17:08:47Z", lastActivityAt: "2026-11-20T17:20:46Z",
    durationHours: 48, closesAt: "2026-11-22T17:08:47Z",
    rollbackCommit: "eb04405e4ec2d64e45d016b6ed3adbc2e8136fbd",
    scope: ["drive-gateway/src/signing.mjs", "drive-gateway/src/router.mjs", "src/pages/EmailSigningReadOnlyPage.jsx", "drive-gateway/tests/", "tests/"],
    prohibitions: ["secrets", "SMTP", "Firestore rules", "certificate logic", "hash logic", "archive logic"],
    activityLog: [{ at: "2026-11-20T17:08:47Z", action: "opened" }]
  };
  const baselineRepairWindow = {
    status: "open", openedAt: "2026-11-20T12:00:00Z",
    activityLog: [{ at: "2026-11-20T12:00:00Z", action: "meeting-window-opened" }],
    parallelWindows: [
      { portal: "Meeting Portal", status: "open", baseline: "meeting-baseline-unchanged" },
      baselineSignature
    ]
  };
  const currentRepairWindow = structuredClone(baselineRepairWindow);
  const currentSignature = currentRepairWindow.parallelWindows.find(item => item.portal === "Signature Portal");
  currentSignature.status = "closed";
  currentSignature.closedAt = "2026-11-20T17:56:30Z";
  currentSignature.lastActivityAt = currentSignature.closedAt;
  currentSignature.closureEvidence = { mergeCommit: "386b73b02e1ae89696ab0a73fea7ee00dd739d48", workerDeployRun: 44787425215 };
  currentSignature.activityLog.push({ at: currentSignature.closedAt, action: "closed" });
  const baselineAmendment = {
    status: "open", affectedPortals: ["Signature Portal"],
    reason: "GET consumed invitation tokens before explicit signing.",
    files: ["drive-gateway/src/signing.mjs", "drive-gateway/src/router.mjs", "src/pages/EmailSigningReadOnlyPage.jsx", "drive-gateway/tests/", "tests/"],
    repairWindow: { openedAt: "2026-11-20T17:08:47Z", rollbackCommit: "eb04405e4ec2d64e45d016b6ed3adbc2e8136fbd" }
  };
  const baselineChangeRecord = {
    schemaVersion: 1, status: "complete",
    declaration: { affectedPortals: ["Signature Portal"], reason: "prior amendment unchanged" },
    baseline: { commit: "main-baseline" }, history: [{ action: "meeting-history-preserved" }],
    activeAmendment: baselineAmendment
  };
  const currentChangeRecord = structuredClone(baselineChangeRecord);
  currentChangeRecord.activeAmendment.status = "closed";
  currentChangeRecord.activeAmendment.closedAt = "2026-11-20T17:56:30Z";
  currentChangeRecord.activeAmendment.completion = {
    mergeCommit: "386b73b02e1ae89696ab0a73fea7ee00dd739d48",
    workerDeployRun: 44787425215, firebaseDeployRun: 44787424924,
    frontendDeployRun: 44787425010, browserSmokeRun: 44787661874,
    productionSmoke: "PASS_WITH_AUTHENTICATED_DOCUMENTS_LIMITATION"
  };
  return {
    changedPaths: [...SIGNATURE_WINDOW_AMENDMENT_PATHS],
    baselineRepairWindow, currentRepairWindow,
    baselineChangeRecord, currentChangeRecord,
    now: new Date("2026-11-20T18:00:00Z")
  };
};

test("isolation guard permits evidence-backed closure of only the Signature Portal window", () => {
  const fixture = closureFixture();
  assert.equal(evaluateSignatureWindowClosure(fixture).pass, true);
});

test("isolation guard blocks closure if the Meeting Portal window changes", () => {
  const fixture = closureFixture();
  fixture.currentRepairWindow.parallelWindows.find(item => item.portal === "Meeting Portal").status = "closed";
  assert.equal(evaluateSignatureWindowClosure(fixture).pass, false);
});

test("isolation guard blocks closure if another portal's Change Record history changes", () => {
  const fixture = closureFixture();
  fixture.currentChangeRecord.history.push({ action: "altered-meeting-history" });
  assert.equal(evaluateSignatureWindowClosure(fixture).pass, false);
});

test("isolation guard blocks closure without deployment and smoke evidence", () => {
  const fixture = closureFixture();
  delete fixture.currentChangeRecord.activeAmendment.completion;
  assert.equal(evaluateSignatureWindowClosure(fixture).pass, false);
});


const reopenFixture = () => {
  const baselineSignature = {
    portal: "Signature Portal", status: "closed",
    openedAt: "2026-11-20T17:08:47Z", lastActivityAt: "2026-11-20T17:56:30Z",
    durationHours: 48, closesAt: "2026-11-22T17:08:47Z",
    rollbackCommit: "eb04405e4ec2d64e45d016b6ed3adbc2e8136fbd",
    reason: "Owner-authorised full Email Signing rebuild: reusable envelope/signer-bound links, explicit open session, expiry, atomic resend, contract suite and protected cutover.",
    scope: [
      "drive-gateway/src/emailSigning/","drive-gateway/src/emailSigningLinks.mjs","drive-gateway/src/signing.mjs",
      "drive-gateway/src/index.js","src/pages/EmailSigningReadOnlyPage.jsx","src/pages/SignaturePlatform.jsx",
      "drive-gateway/tests/email-signing-contract.test.mjs","drive-gateway/tests/email-signing-links.test.mjs",
      "drive-gateway/tests/email-signing-links.integration.test.mjs","tests/email-signing-contract.test.mjs",
      ".github/workflows/email-signing-contract.yml","scripts/meeting-portal-fixture-isolation-guard.sh",
      "scripts/portal-repair-window-guard-policy.mjs","tests/meeting-isolation-guard.test.mjs"
    ],
    prohibitions: ["secrets","SMTP","Firestore rules","certificate logic","hash logic","archive logic"],
    activityLog: [
      { at:"2026-11-20T17:08:47Z", action:"opened" },
      { at:"2026-11-20T17:20:46Z", action:"rollback-reference-verified" },
      { at:"2026-11-20T17:47:37Z", action:"scope-amended" },
      { at:"2026-11-20T17:56:30Z", action:"closed" }
    ],
    closureEvidence: { repairPR:817, closurePR:820, mergeCommit:"386b73b02e1ae89696ab0a73fea7ee00dd739d48" }
  };
  const baselineRepairWindow = {
    status:"open",
    parallelWindows:[
      { portal:"Meeting Portal", status:"open", baseline:"meeting-baseline-unchanged" },
      baselineSignature
    ]
  };
  const currentRepairWindow = JSON.parse(JSON.stringify(baselineRepairWindow));
  const currentSignature = currentRepairWindow.parallelWindows.find(item=>item.portal==="Signature Portal");
  currentSignature.status="open";
  delete currentSignature.closedAt;
  currentSignature.reopenedAt="2026-11-20T18:10:00Z";
  currentSignature.lastActivityAt=currentSignature.reopenedAt;
  currentSignature.activityLog.push({at:currentSignature.reopenedAt,action:"reopened"});
  const baselineAmendment = {
    status:"closed", affectedPortals:["Signature Portal"],
    reason:"Rebuild email signing around reusable envelope-and-signer-bound links, explicit POST/open sessions, deterministic expiry, atomic resend after SMTP acceptance, signer-row and bulk resend, masked EAT confirmation, stage diagnostics, audit events, and owner/admin SMTP self-check.",
    files:baselineSignature.scope,
    repairWindow:{openedAt:"2026-11-20T17:08:47Z",closesAt:"2026-11-22T17:08:47Z",durationHours:48,rollbackCommit:"eb04405e4ec2d64e45d016b6ed3adbc2e8136fbd",rollbackCommitEvidence:"verified"},
    prohibitedChanges:["Secrets","Environment variables","SMTP credentials and settings (reuse existing wrapper)","Firestore rules","PDF stamping engine","Hash logic","Certificate logic","Archive logic"],
    ownerInstruction:"Execute the complete Email Signing rebuild on feat/email-signing-rebuild-20261120.",
    closedAt:"2026-11-20T17:56:30Z",
    completion:{mergeCommit:"386b73b02e1ae89696ab0a73fea7ee00dd739d48",productionSmoke:"PASS_WITH_AUTHENTICATED_DOCUMENTS_LIMITATION"}
  };
  const baselineChangeRecord = {
    schemaVersion:1,status:"complete",declaration:{affectedPortals:["Signature Portal"]},
    baseline:{commit:"main-baseline"},history:[{action:"meeting-history-preserved"}],
    closure:{closedAt:"",updatedBaselineCommit:""},activeAmendment:baselineAmendment
  };
  const currentChangeRecord = JSON.parse(JSON.stringify(baselineChangeRecord));
  currentChangeRecord.activeAmendment.status="open";
  currentChangeRecord.activeAmendment.reopenedAt="2026-11-20T18:10:00Z";
  currentChangeRecord.activeAmendment.reopenReason="PR #820 closed the window before the owner-authorised full Email Signing rebuild on feat/email-signing-rebuild-20261120 was completed.";
  currentChangeRecord.activeAmendment.priorClosure={
    closedAt:baselineAmendment.closedAt,
    completion:baselineAmendment.completion,
    closedByPR:820
  };
  return {
    changedPaths:[...SIGNATURE_WINDOW_AMENDMENT_PATHS],
    baselineRepairWindow,currentRepairWindow,
    baselineChangeRecord,currentChangeRecord,
    now:new Date("2026-11-20T18:15:00Z")
  };
};

test("isolation guard reopens only the owner-authorised full Email Signing rebuild and preserves the prior closure",()=>{
  const fixture=reopenFixture();
  assert.equal(evaluateSignatureWindowReopen(fixture).pass,true);
});

test("isolation guard blocks reopening if the Meeting Portal window changes",()=>{
  const fixture=reopenFixture();
  fixture.currentRepairWindow.parallelWindows.find(item=>item.portal==="Meeting Portal").status="closed";
  assert.equal(evaluateSignatureWindowReopen(fixture).pass,false);
});

test("isolation guard blocks reopening without the prior closure evidence",()=>{
  const fixture=reopenFixture();
  delete fixture.currentChangeRecord.activeAmendment.priorClosure;
  assert.equal(evaluateSignatureWindowReopen(fixture).pass,false);
});

test("isolation guard blocks reopening if another portal's Change Record history changes",()=>{
  const fixture=reopenFixture();
  fixture.currentChangeRecord.history.push({action:"altered-meeting-history"});
  assert.equal(evaluateSignatureWindowReopen(fixture).pass,false);
});


test("Signature email-delivery diagnostics repair has a narrow Change Record policy and does not require rebuild branches", () => {
  assert.match(policy, /amendment\.operation === "email-delivery-diagnostics-repair"/);
  for (const path of [
    "drive-gateway/src/invitationEmail.mjs",
    "drive-gateway/src/signing.mjs",
    "drive-gateway/src/index.js",
    "drive-gateway/src/router.mjs",
    "drive-gateway/src/smtpDiagnostics.mjs",
    "src/pages/SignaturePlatform.jsx",
    "drive-gateway/tests/email-delivery-diagnostics.test.mjs",
    ".github/workflows/email-deliverability-dns-check.yml",
    "docs/email-deliverability/HOSTING_REQUEST.md"
  ]) assert.ok(policy.includes(path), "missing scoped delivery repair path: " + path);
  assert.doesNotMatch(policy.slice(policy.indexOf('const deliveryDiagnosticsRepair'), policy.indexOf('] : rollbackMode')), /emailSigning\//);
});
