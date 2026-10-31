import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/meeting-portal-fixture-browser.yml", import.meta.url), "utf8");
const guard = readFileSync(new URL("../scripts/ci/meeting-fixture-isolation.mjs", import.meta.url), "utf8");

test("runtime isolation guard is mandatory, receives the event name, and runs after fetching main", () => {
  const stepMarker = "- name: Assert runtime source isolation from unrelated portals";
  const stepIndex = workflow.indexOf(stepMarker);
  assert.notEqual(stepIndex, -1, "workflow must retain the runtime source-isolation guard step");
  const nextStepIndex = workflow.indexOf("\n      - name:", stepIndex + stepMarker.length);
  const step = workflow.slice(stepIndex, nextStepIndex < 0 ? undefined : nextStepIndex);
  assert.match(step, /env:\s*\n\s+EVENT_NAME:\s*\$\{\{\s*github\.event_name\s*\}\}/,
    "guard must receive EVENT_NAME from github.event_name in env");
  const run = step.match(/run:\s*\|([\s\S]*)/);
  assert.ok(run, "guard step must have a run block");
  const fetchIndex = run[1].indexOf("git fetch origin main");
  const scriptIndex = run[1].indexOf("node scripts/ci/meeting-fixture-isolation.mjs");
  assert.notEqual(fetchIndex, -1, "guard step must fetch origin main");
  assert.notEqual(scriptIndex, -1, "guard step must execute the extracted isolation script");
  assert.ok(fetchIndex < scriptIndex, "isolation script must execute after git fetch origin main");
  assert.doesNotMatch(step, /continue-on-error:\s*true/, "guard cannot be continue-on-error");
  assert.doesNotMatch(step, /\n\s+if\s*:/, "guard cannot be conditional or skippable");
  assert.doesNotMatch(step, /\n\s+continue-on-error\s*:/, "guard cannot be continue-on-error");
});

test("extracted script retains every baseline allowlist entry by exact path", () => {
  const block = guard.match(/const allowed = new Set\(\[([\s\S]*?)\n\]\);/);
  assert.ok(block, "script must declare the explicit changed-path allowlist");
  const actual = [...block[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const expected = [
  ".github/workflows/meeting-portal-fixture-browser.yml",
  "scripts/ci/meeting-fixture-isolation.mjs",
  ".github/workflows/finance-production-reset.yml",
  "docs/ACTUAL_DATA_ACCESS_GATE.md",
  "scripts/reset-finance-production.js",
  "src/FieldEntryDataGate.jsx",
  "src/components/ActualDataAccessControl.jsx",
  "src/firebase/systemControl.js",
  "src/pages/Settings.jsx",
  "src/pages/FinancePortfolio.jsx",
  "tests/finance-portal-policy.test.cjs",
  "tests/firestore.rules.test.cjs",
  "tests/research-portal-security.test.mjs",
  "tests/meeting-isolation-guard.test.mjs",
  "tests/invitation-removal-policy.test.mjs",
  "tests/meeting-invitation-resend-quorum.test.mjs",
  "tests/signature-signer-picker-regression.test.mjs",
  ".github/workflows/meeting-invitation-flow-ci.yml",
  ".github/workflows/mail-invitation-tests.yml",
  ".github/workflows/cloudflare-gateway-deploy.yml",
  ".github/workflows/cloudflare-livekit-staging-frontend.yml",
  ".github/workflows/staging-gateway-e2e.yml",
  "drive-gateway/src/cryptographicGate.mjs",
  "drive-gateway/src/esignContext.mjs",
  "drive-gateway/src/pdf.mjs",
  "drive-gateway/src/router.mjs",
  "drive-gateway/src/signing.mjs",
  "drive-gateway/src/upload.mjs",
  "drive-gateway/tests/controlled-authenticated-signing-flow.test.mjs",
  "drive-gateway/tests/e2e.test.mjs",
  "drive-gateway/tests/gate5-document-signature-persistence.test.mjs",
  "drive-gateway/tests/production-crypto-integration.test.mjs",
  "drive-gateway/tests/staging-crypto-acceptance.test.mjs",
  "drive-gateway/tests/staging-runtime-acceptance.mjs",
  "src/App.jsx",
  "src/pages/GatewaySigningPortal.jsx",
  "drive-gateway/src/index.js",
  "drive-gateway/src/meetingPortal.mjs",
  "drive-gateway/tests/meeting-portal.test.mjs",
  "src/firebase/meetingGatewayApi.js",
  "drive-gateway/src/invitationEmail.mjs",
  "drive-gateway/src/invitationRedemption.mjs",
  "drive-gateway/tests/mail-invitation.unit.mjs",
  "drive-gateway/tests/invitation-redemption.test.mjs",
  ".github/workflows/meeting-invitation-nonprod-e2e.yml",
  ".github/workflows/meeting-invitation-staging-smtp-check.yml",
  ".github/workflows/meeting-room-authorization-boundary.yml",
  "functions/meetingGateway.emulator.test.cjs",
  "functions/meetingEntryPolicy.js",
  "functions/meetingEntryPolicy.test.cjs",
  "functions/meetingGateway.js",
  "package.json",
  "src/components/MeetingAccessControl.jsx",
  "src/pages/Invitations.jsx",
  "public/administrator.html",
  "src/firebase/auth.js",
  "src/pages/MeetingEntryGateway.jsx",
  "src/components/ControlledDocumentUpload.jsx",
  "src/components/SignaturePathwaySelfTest.jsx",
  "tests/signature-pathway-contract.test.mjs",
  "src/firebase/meetingRecords.js",
  "functions/meetingRecords.js",
  "functions/index.js",
  "tests/meeting-working-documents-security.test.mjs",
  "src/pages/MeetingRoom.jsx",
  "src/pages/OperationalGatewaysParticipants.jsx",
  "src/pages/Meetings.jsx",
  "src/firebase/data.js",
  "firestore.rules",
  "tests/meeting-category-firestore-rules.test.cjs",
  "tests/meeting-category-policy.test.mjs",
  ".github/workflows/signature-migration-build-test.yml",
  "drive-gateway/wrangler.toml",
  "drive-gateway/src/signatureAssetAuthorization.mjs",
  "drive-gateway/src/signatureProfileAuthorization.mjs",
  "drive-gateway/tests/signature-asset-authorization.test.mjs",
  "drive-gateway/tests/signature-profile-folder-authorization.test.mjs",
  "drive-gateway/tests/signature-profile-folder-runtime.test.mjs",
  "src/firebase/signaturePlatform.js",
  "src/firebase/signatureStorage.js",
  "src/firebase/signatureWorkflowPolicy.js",
  "src/pages/SignaturePlatform.jsx",
  "tests/signature-workflow-policy.test.mjs",
  "tests/fixtures/meeting-portal-fixture.html",
  "tests/fixtures/meeting-portal-fixture.jsx",
  "tests/fixtures/mocks.js",
  "tests/meeting-portal-browser.test.mjs",
  "tests/meeting-room-authorization-boundary.test.mjs",
  "tests/browser/authenticated-governance-regression.spec.mjs",
  ".github/workflows/authenticated-governance-browser-fixture.yml",
  ".github/workflows/cloudflare-esignature-tests.yml",
  ".github/workflows/document-lifecycle-module-test.yml",
  ".github/workflows/document-translation-workspace-test.yml",
  ".github/workflows/fundraising-responsive-smoke.yml",
  ".github/workflows/meeting-media-governance.yml",
  ".github/workflows/meeting-room-ai-assistant-verification.yml",
  ".github/workflows/pdf-esignature-tests.yml",
  ".github/workflows/readability-release-gate.yml",
  "src/App.jsx",
  "package.json",
  "src/styles/portal-readability-standard.css",
  "tests/portal-readability-standard.test.mjs",
  "vite.meeting-fixture.config.js",
  ".github/workflows/portal-navigation-regression.yml",
  "docs/COMMUNICATION_MEDIA_PORTAL.md",
  "functions/communicationMedia.js",
  "src/pages/CommunicationMediaPortal.jsx",
  "src/pages/CommunicationMediaStudio.jsx",
  "tests/communication-media-policy.test.mjs"
];
  assert.deepEqual(actual, expected, "allowlist paths and ordering must remain unchanged");
});

test("all named isolation policy gates remain present and participate in the final decision", () => {
  for (const name of ["signaturePathwayContractRepair","signatureGatewayIntegration","signatureSignerPickerRepair","signaturePdfPaletteRepair","signatureSignerListVisibilityRepair","signaturePaletteLifecycleSourceRepair","signatureDocumentPaletteAssignmentRepair","signaturePdfUrlHandoffRepair","signaturePdfArchivePaletteRepair","controlledDocumentTrialUploadFix","actualDataGateIntegration","grantAssistantPersistence","communicationMediaIntegration","communicationMediaArchiveIntegration","guardOnlyWorkflowRepair","fixtureWorkflowScriptRepair","invitationMailResendIntegration","invitationRemovalIntegration","communicationMediaOnly","readabilityOnlyChange"]) {
    assert.match(guard, new RegExp("const " + name + "\\s*="), name + " policy definition must remain");
    assert.ok(guard.includes("!" + name), name + " must remain part of the final policy gate");
  }
  for (const required of [
    'const eventName = process.env.EVENT_NAME?.trim()',
    'const base = "origin/main"',
    'git", ["diff", "--name-only"',
    'const unexpected = changed.filter(path =>',
    'Unexpected files changed outside the isolated meeting repair',
    'Meeting/participant source change or an explicitly paired isolated regression/guard test is missing'
  ]) assert.ok(guard.includes(required), "missing policy check: " + required);
});

test("fixture workflow/script exception is limited to the two approved files", () => {
  assert.match(guard, /const fixtureWorkflowScriptRepair\s*=\s*changed\.includes\("\.github\/workflows\/meeting-portal-fixture-browser\.yml"\)/);
  assert.match(guard, /changed\.includes\("scripts\/ci\/meeting-fixture-isolation\.mjs"\)/);
  assert.match(guard, /changed\.every\(path => path === "\.github\/workflows\/meeting-portal-fixture-browser\.yml" \|\| path === "scripts\/ci\/meeting-fixture-isolation\.mjs"\)/);
  assert.match(guard, /!fixtureWorkflowScriptRepair/);
});

test("guard-only test maintenance exception remains separate and narrowly scoped", () => {
  assert.match(guard, /const guardOnlyWorkflowRepair\s*=/);
  assert.match(guard, /changed\.includes\("tests\/meeting-isolation-guard\.test\.mjs"\)/);
  assert.match(guard, /!guardOnlyWorkflowRepair/);
});

test("Wrangler production configuration and staging KV isolation checks remain enforced", () => {
  for (const check of [
    'if (changed.includes(wranglerPath))',
    'productionSection(baselineConfig, "Baseline Wrangler config") !== productionSection(currentConfig, "Current Wrangler config")',
    'Production Wrangler configuration changed; only staging-only changes are permitted',
    'id = "5ea76010553049a2b98c8493c37fbbc4"',
    'id = "ccdbffa662ac48bfbdf7f4b1f62ca941"',
    'Staging DRIVE_KV must retain the explicitly approved dedicated namespace',
    'Production DRIVE_KV cannot be used by staging'
  ]) assert.ok(guard.includes(check), "missing Wrangler/KV policy: " + check);
});
