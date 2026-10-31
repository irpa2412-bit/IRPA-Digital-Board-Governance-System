import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/meeting-portal-fixture-browser.yml", import.meta.url), "utf8");
const guard = readFileSync(new URL("../scripts/ci/meeting-fixture-isolation.mjs", import.meta.url), "utf8");

test("isolation guard runs after fetching main and receives the GitHub event name", () => {
  const fetchIndex = workflow.indexOf("git fetch origin main:refs/remotes/origin/main");
  const stepIndex = workflow.indexOf("- name: Assert runtime source isolation from unrelated portals");
  assert.notEqual(fetchIndex, -1, "workflow must fetch origin main");
  assert.notEqual(stepIndex, -1, "workflow must retain the runtime source-isolation guard step");
  assert.ok(fetchIndex < stepIndex, "the guard must run after git fetch origin main");
  const nextStepIndex = workflow.indexOf("\n      - name:", stepIndex + 1);
  const step = workflow.slice(stepIndex, nextStepIndex < 0 ? undefined : nextStepIndex);
  assert.match(step, /env:\s*\n\s+EVENT_NAME:\s*\$\{\{\s*github\.event_name\s*\}\}/);
  assert.match(step, /run:\s*\|[\s\S]*?node scripts\/ci\/meeting-fixture-isolation\.mjs/);
  assert.doesNotMatch(step, /continue-on-error:\s*true/);
  assert.doesNotMatch(step, /if:\s*false|if:\s*\$\{\{\s*false/);
});

test("extracted isolation script retains baseline, allowlist, and all isolation policy checks", () => {
  assert.match(guard, /const eventName = process\.env\.EVENT_NAME\?\.trim\(\)/);
  assert.match(guard, /const base = "origin\/main"/);
  assert.match(guard, /git.*diff.*--name-only/);
  assert.match(guard, /const allowed = new Set\(\[/);
  assert.match(guard, /const unexpected = changed\.filter\(path =>/);
  assert.match(guard, /Unexpected files changed outside the isolated meeting repair/);
  assert.match(guard, /Meeting\/participant source change or an explicitly paired isolated regression\/guard test is missing/);
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

test("guard-only guard maintenance requires its paired regression test", () => {
  assert.match(guard, /const guardOnlyWorkflowRepair = changed\.includes\("\.github\/guards\/meeting-portal-fixture-browser\.yml"\)/);
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

test("Signature Gateway isolation does not exempt unrelated staging admin reset guards", () => {
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
  assert.match(guard, /changed\.includes\("tests\/signature-guard-policy\.test\.mjs"\)/);
  assert.match(guard, /!signaturePdfPaletteRepair/);
  assert.match(guard, /changed\.every\(path => \["\.github\/guards\/meeting-portal-fixture-browser\.yml", "tests\/meeting-isolation-guard\.test\.mjs", "src\/pages\/SignaturePlatform\.jsx", "src\/firebase\/signatureStorage\.js", "tests\/signature-guard-policy\.test\.mjs"\]\.includes\(path\)\)/);
});


test("PDF URL handoff repair is narrowly paired with its policy regression test", () => {
  assert.match(guard, /const signaturePdfUrlHandoffRepair = changed\.includes\("src\/pages\/SignaturePlatform\.jsx"\)/);
  assert.match(guard, /changed\.includes\("tests\/signature-guard-policy\.test\.mjs"\)/);
  assert.match(guard, /!signaturePdfUrlHandoffRepair/);
  assert.match(guard, /changed\.every\(path => \["\.github\/guards\/meeting-portal-fixture-browser\.yml", "tests\/meeting-isolation-guard\.test\.mjs", "src\/pages\/SignaturePlatform\.jsx", "tests\/signature-guard-policy\.test\.mjs"\]\.includes\(path\)\)/);
});


test("selected signer list visibility fix is narrowly paired with its regression test", () => {
  assert.match(guard, /const signatureSignerListVisibilityRepair = changed\.includes\("src\/pages\/SignaturePlatform\.jsx"\)/);
  assert.match(guard, /changed\.includes\("tests\/signature-signer-picker-regression\.test\.mjs"\)/);
  assert.match(guard, /!signatureSignerListVisibilityRepair/);
  assert.match(guard, /changed\.every\(path => \["\.github\/guards\/meeting-portal-fixture-browser\.yml", "tests\/meeting-isolation-guard\.test\.mjs", "src\/pages\/SignaturePlatform\.jsx", "tests\/signature-signer-picker-regression\.test\.mjs"\]\.includes\(path\)\)/);
});


test("Signature document palette and assignment repair is narrowly paired with access-rule tests", () => {
  assert.match(guard, /const signatureDocumentPaletteAssignmentRepair = changed\.includes\("src\/pages\/SignaturePlatform\.jsx"\)/);
  assert.match(guard, /changed\.includes\("src\/firebase\/data\.js"\)/);
  assert.match(guard, /changed\.includes\("firestore\.rules"\)/);
  assert.match(guard, /changed\.includes\("tests\/firestore\.rules\.test\.cjs"\)/);
  assert.match(guard, /!signatureDocumentPaletteAssignmentRepair/);
  assert.match(guard, /!signatureDocumentPaletteAssignmentRepair && !signaturePaletteLifecycleSourceRepair && !signaturePdfArchivePaletteRepair && !guardOnlyWorkflowRepair/);
});


test("Signature palette lifecycle source repair is paired with regression coverage", () => {
  assert.match(guard, /const signaturePaletteLifecycleSourceRepair = changed\.includes\("src\/firebase\/data\.js"\)/);
  assert.match(guard, /changed\.includes\("tests\/signature-guard-policy\.test\.mjs"\)/);
  assert.match(guard, /!signatureDocumentPaletteAssignmentRepair && !signaturePaletteLifecycleSourceRepair && !signaturePdfArchivePaletteRepair && !guardOnlyWorkflowRepair/);
});


test("archive-backed Signature Portal PDF palette repair is explicitly paired and path-limited", () => {
  assert.match(guard, /const signaturePdfArchivePaletteRepair = changed\.includes\("src\/firebase\/data\.js"\)/);
  assert.match(guard, /changed\.includes\("src\/pages\/SignaturePlatform\.jsx"\)/);
  assert.match(guard, /changed\.includes\("tests\/signature-guard-policy\.test\.mjs"\)/);
  assert.match(guard, /!signaturePdfArchivePaletteRepair/);
  assert.match(guard, /changed\.every\(path => \["\.github\/guards\/meeting-portal-fixture-browser\.yml", "tests\/meeting-isolation-guard\.test\.mjs", "src\/firebase\/data\.js", "src\/pages\/SignaturePlatform\.jsx", "tests\/signature-guard-policy\.test\.mjs"\]\.includes\(path\)\)/);
});
