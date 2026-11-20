import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/meeting-portal-fixture-browser.yml", import.meta.url), "utf8");
const guard = readFileSync(new URL("../scripts/meeting-portal-fixture-isolation-guard.sh", import.meta.url), "utf8");

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

test("parallel portal window amendment requires both records and semantic isolation guard", () => {
  assert.match(guard, /const parallelWindowRecordAmendment = changed\.includes\("docs\/portal-protection\/repair-window\.json"\)/);
  assert.match(guard, /changed\.includes\("docs\/portal-protection\/change-record\.json"\)/);
  assert.match(guard, /changed\.includes\("scripts\/meeting-portal-fixture-isolation-guard\.sh"\)/);
  assert.match(guard, /changed\.includes\("tests\/meeting-isolation-guard\.test\.mjs"\)/);
  assert.match(guard, /!parallelWindowRecordAmendment/);
});


import {
  evaluateSignatureWindowAmendment,
  SIGNATURE_WINDOW_AMENDMENT_PATHS
} from "../scripts/portal-repair-window-guard-policy.mjs";

const isolatedWindowFixture = () => {
  const activeAmendment = {
    status: "open",
    files: ["drive-gateway/src/signing.mjs", "drive-gateway/src/emailSigningLinks.mjs"],
    repairWindow: { rollbackCommit: "fd3e5c8580c28d0c00f2ad0ca1c62e0131abafb8" }
  };
  const baselineChangeRecord = { status: "complete", repairWindow: { status: "open", portal: "Meeting Portal" }, history: [{ action: "meeting-window-opened" }] };
  const currentChangeRecord = { ...structuredClone(baselineChangeRecord), activeAmendment };
  const repairWindow = {
    parallelWindows: [{
      portal: "Signature Portal",
      status: "open",
      closesAt: "2026-11-22T17:08:47Z",
      rollbackCommit: "fd3e5c8580c28d0c00f2ad0ca1c62e0131abafb8"
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
