import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/meeting-portal-fixture-browser.yml", import.meta.url), "utf8");

test("isolation baseline compares against the fetched current main snapshot", () => {
  assert.match(workflow, /git fetch origin main:refs\/remotes\/origin\/main/);
  assert.match(workflow, /const eventName = process\.env\.EVENT_NAME\?\.trim\(\)/);
  assert.match(workflow, /const base = "origin\/main"/);
  assert.ok(workflow.includes('git", ["diff", "--name-only", `${base}...HEAD`]'));
});

test("Wrangler changes cannot alter production configuration", () => {
  assert.match(workflow, /if \(changed\.includes\(wranglerPath\)\)/);
  assert.match(workflow, /productionSection\(baselineConfig, "Baseline Wrangler config"\) !== productionSection\(currentConfig, "Current Wrangler config"\)/);
  assert.match(workflow, /Production Wrangler configuration changed; only staging-only changes are permitted/);
});

test("staging keeps its dedicated KV namespace and rejects the production namespace", () => {
  assert.match(workflow, /id = "5ea76010553049a2b98c8493c37fbbc4"/);
  assert.match(workflow, /id = "ccdbffa662ac48bfbdf7f4b1f62ca941"/);
  assert.match(workflow, /Staging DRIVE_KV must retain the explicitly approved dedicated namespace/);
  assert.match(workflow, /Production DRIVE_KV cannot be used by staging/);
});

test("workflow-only guard maintenance requires its paired regression test", () => {
  assert.match(workflow, /const guardOnlyWorkflowRepair = changed\.includes\("\.github\/workflows\/meeting-portal-fixture-browser\.yml"\)/);
  assert.match(workflow, /changed\.includes\("tests\/meeting-isolation-guard\.test\.mjs"\)/);
  assert.match(workflow, /!guardOnlyWorkflowRepair/);
});

test("invitation resend regression is explicitly allowlisted by the isolation guard", () => {
  assert.ok(workflow.includes('"tests/meeting-invitation-resend-quorum.test.mjs"'));
});

test("invitation/reset integration exception requires all paired implementation and test files", () => {
  assert.match(workflow, /const invitationMailResendIntegration = changed\.includes\("public\/administrator\.html"\)/);
  for (const path of [
    "public/administrator.html",
    "src/firebase/auth.js",
    "src/pages/Invitations.jsx",
    "drive-gateway/src/index.js",
    "drive-gateway/src/invitationEmail.mjs",
    "drive-gateway/tests/mail-invitation.unit.mjs",
  ]) {
    assert.ok(workflow.includes(`"${path}"`), `missing required paired path: ${path}`);
  }
  assert.match(workflow, /changed\.every\(path => allowed\.has\(path\)\)/);
  assert.match(workflow, /!invitationMailResendIntegration/);
});

test("Signature Gateway integration must include its portal bridge and authenticated flow test", () => {
  assert.match(workflow, /const signatureGatewayIntegration = changed\.includes\("src\/firebase\/signaturePlatform\.js"\)/);
  assert.match(workflow, /changed\.includes\("drive-gateway\/src\/signing\.mjs"\)/);
  assert.match(workflow, /changed\.includes\("drive-gateway\/tests\/controlled-authenticated-signing-flow\.test\.mjs"\)/);
  assert.match(workflow, /!signatureGatewayIntegration/);
});

test("Signature Gateway isolation does not exempt unrelated staging admin reset workflows", () => {
  assert.match(workflow, /!allowed\.has\(path\).*signatureGatewayIntegration/);
  assert.doesNotMatch(workflow, /staging-admin-reset-fixture\.yml/);
});

test("Communication and Media archive gateway integration is explicitly isolated and allowlisted", () => {
  assert.match(workflow, /const communicationMediaArchiveIntegration =/);
  assert.match(workflow, /changed\.includes\("src\/pages\/CommunicationMediaStudio\.jsx"\)/);
  assert.match(workflow, /changed\.includes\("tests\/communication-media-policy\.test\.mjs"\)/);
  assert.match(workflow, /changed\.includes\("drive-gateway\/src\/index\.js"\)/);
  assert.match(workflow, /changed\.includes\("drive-gateway\/wrangler\.toml"\)/);
  assert.match(workflow, /"drive-gateway\/tests\/staging-isolation\.test\.mjs"/);
  assert.match(workflow, /"firestore\.rules"/);
  assert.match(workflow, /changed\.includes\("src\/firebase\/signatureStorage\.js"\)/);
  assert.match(workflow, /changed\.includes\("docs\/COMMUNICATION_MEDIA_PORTAL\.md"\)/);
  assert.match(workflow, /!changed\.includes\("src\/pages\/Meetings\.jsx"\)/);
  assert.match(workflow, /!changed\.includes\("src\/pages\/OperationalGatewaysParticipants\.jsx"\)/);
  assert.match(workflow, /communicationMediaArchiveIntegration && communicationMediaArchivePaths\.has\(path\)/);
});

test("readability-only PRs are narrowly allowlisted without permitting unrelated portal source changes", () => {
  assert.match(workflow, /const readabilityOnlyFiles = new Set\(\[/);
  assert.ok(workflow.includes('"--name-only", `${base}...HEAD`'));
  assert.match(workflow, /changed\.includes\("src\/styles\/portal-readability-standard\.css"\)/);
  assert.match(workflow, /changed\.every\(path => readabilityOnlyFiles\.has\(path\)\)/);
  assert.match(workflow, /!readabilityOnlyChange/);
  assert.match(workflow, /"src\/App\.jsx"/);
  assert.match(workflow, /"tests\/browser\/authenticated-governance-regression\.spec\.mjs"/);
});

test("controlled-document trial upload permission fix must remain paired with Firestore rule regression tests", () => {
  assert.match(workflow, /const controlledDocumentTrialUploadFix = changed\.includes\("firestore\.rules"\)/);
  assert.match(workflow, /changed\.includes\("tests\/firestore\.rules\.test\.cjs"\)/);
  assert.match(workflow, /!controlledDocumentTrialUploadFix/);
});

test("PDF palette repair is isolated to the signature page, scoped storage helper and paired policy test", () => {
  assert.match(workflow, /const signaturePdfPaletteRepair = changed\.includes\("src\/pages\/SignaturePlatform\.jsx"\)/);
  assert.match(workflow, /changed\.includes\("src\/firebase\/signatureStorage\.js"\)/);
  assert.match(workflow, /changed\.includes\("tests\/signature-workflow-policy\.test\.mjs"\)/);
  assert.match(workflow, /!signaturePdfPaletteRepair/);
  assert.match(workflow, /changed\.every\(path => \["\.github\/workflows\/meeting-portal-fixture-browser\.yml", "tests\/meeting-isolation-guard\.test\.mjs", "src\/pages\/SignaturePlatform\.jsx", "src\/firebase\/signatureStorage\.js", "tests\/signature-workflow-policy\.test\.mjs"\]\.includes\(path\)\)/);
});


test("PDF URL handoff repair is narrowly paired with its policy regression test", () => {
  assert.match(workflow, /const signaturePdfUrlHandoffRepair = changed\.includes\("src\/pages\/SignaturePlatform\.jsx"\)/);
  assert.match(workflow, /changed\.includes\("tests\/signature-workflow-policy\.test\.mjs"\)/);
  assert.match(workflow, /!signaturePdfUrlHandoffRepair/);
  assert.match(workflow, /changed\.every\(path => \["\.github\/workflows\/meeting-portal-fixture-browser\.yml", "tests\/meeting-isolation-guard\.test\.mjs", "src\/pages\/SignaturePlatform\.jsx", "tests\/signature-workflow-policy\.test\.mjs"\]\.includes\(path\)\)/);
});


test("selected signer list visibility fix is narrowly paired with its regression test", () => {
  assert.match(workflow, /const signatureSignerListVisibilityRepair = changed\.includes\("src\/pages\/SignaturePlatform\.jsx"\)/);
  assert.match(workflow, /changed\.includes\("tests\/signature-signer-picker-regression\.test\.mjs"\)/);
  assert.match(workflow, /!signatureSignerListVisibilityRepair/);
  assert.match(workflow, /changed\.every\(path => \["\.github\/workflows\/meeting-portal-fixture-browser\.yml", "tests\/meeting-isolation-guard\.test\.mjs", "src\/pages\/SignaturePlatform\.jsx", "tests\/signature-signer-picker-regression\.test\.mjs"\]\.includes\(path\)\)/);
});


test("Signature document palette and assignment repair is narrowly paired with access-rule tests", () => {
  assert.match(workflow, /const signatureDocumentPaletteAssignmentRepair = changed\.includes\("src\/pages\/SignaturePlatform\.jsx"\)/);
  assert.match(workflow, /changed\.includes\("src\/firebase\/data\.js"\)/);
  assert.match(workflow, /changed\.includes\("firestore\.rules"\)/);
  assert.match(workflow, /changed\.includes\("tests\/firestore\.rules\.test\.cjs"\)/);
  assert.match(workflow, /!signatureDocumentPaletteAssignmentRepair/);
  assert.match(workflow, /!signatureDocumentPaletteAssignmentRepair && !signaturePaletteLifecycleSourceRepair && !signaturePdfArchivePaletteRepair && !guardOnlyWorkflowRepair/);
});


test("Signature palette lifecycle source repair is paired with regression coverage", () => {
  assert.match(workflow, /const signaturePaletteLifecycleSourceRepair = changed\.includes\("src\/firebase\/data\.js"\)/);
  assert.match(workflow, /changed\.includes\("tests\/signature-workflow-policy\.test\.mjs"\)/);
  assert.match(workflow, /!signatureDocumentPaletteAssignmentRepair && !signaturePaletteLifecycleSourceRepair && !signaturePdfArchivePaletteRepair && !guardOnlyWorkflowRepair/);
});


test("archive-backed Signature Portal PDF palette repair is explicitly paired and path-limited", () => {
  assert.match(workflow, /const signaturePdfArchivePaletteRepair = changed\.includes\("src\/firebase\/data\.js"\)/);
  assert.match(workflow, /changed\.includes\("src\/pages\/SignaturePlatform\.jsx"\)/);
  assert.match(workflow, /changed\.includes\("tests\/signature-workflow-policy\.test\.mjs"\)/);
  assert.match(workflow, /!signaturePdfArchivePaletteRepair/);
  assert.match(workflow, /changed\.every\(path => \["\.github\/workflows\/meeting-portal-fixture-browser\.yml", "tests\/meeting-isolation-guard\.test\.mjs", "src\/firebase\/data\.js", "src\/pages\/SignaturePlatform\.jsx", "tests\/signature-workflow-policy\.test\.mjs"\]\.includes\(path\)\)/);
});
