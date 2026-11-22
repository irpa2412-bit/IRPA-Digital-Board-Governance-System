#!/usr/bin/env bash
set -euo pipefail
git fetch origin main:refs/remotes/origin/main
EVENT_NAME="${EVENT_NAME:-}" node --input-type=module <<'NODE'
import { execFileSync } from "node:child_process";
import { evaluateSignatureWindowAmendment, evaluateSignatureWindowRepair, evaluateSignatureWindowClosure, evaluateSignatureWindowReopen } from "./scripts/portal-repair-window-guard-policy.mjs";
import { classifyProtectionOnlyChange } from "./scripts/portal-protection-check.mjs";
// Compare against the fetched main snapshot for both PR and push runs.
// Keep the path allowlist strict while excluding main-only files added after
// this feature branch diverged; no portal source or workflow is exempted.
const eventName = process.env.EVENT_NAME?.trim();
const isMainPush = eventName === "push" && process.env.GITHUB_REF === "refs/heads/main";
const base = "origin/main";
execFileSync("git", ["cat-file", "-e", `${base}^{commit}`]);
const changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort();
const protectionOnlyClassification = classifyProtectionOnlyChange(changed);
if (protectionOnlyClassification.eligible) {
  console.log(JSON.stringify({
    classificationOnly: true,
    eligible: true,
    reason: "Protection-only changes are classified here; owner approval is independently verified by the required security-baseline policy gate."
  }));
  process.exit(0);
}
const allowed = new Set([
  ".github/workflows/meeting-portal-fixture-browser.yml",
  "docs/portal-protection/repair-window.json",
  "docs/portal-protection/records/meeting-portal.json",
  "docs/portal-protection/windows/meeting-portal.json",
  "scripts/portal-protection-check.mjs",
  "tests/portal-protection-policy.test.mjs",
  "docs/portal-protection/change-record.json",
  "scripts/meeting-portal-fixture-isolation-guard.sh",
  "scripts/portal-repair-window-guard-policy.mjs",
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
  "tests/meeting-trial-delete-ui.test.mjs",
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
  "drive-gateway/src/meetingServices.mjs",
  "drive-gateway/src/meetingEnvironment.mjs",
  "drive-gateway/src/meetingDeletion.mjs",
  "drive-gateway/tests/meeting-environment.test.mjs",
  "drive-gateway/tests/meeting-trial-deletion.test.mjs",
  "docs/implementation-status.md",
  "src/firebase/meetingAttendanceSigning.js",
  "src/firebase/meetingAttendanceSignerIdentity.js",
  "tests/meeting-daily-attendance-email-signing.test.mjs",
  "tests/meeting-attendance-guest-identity.test.mjs",
  "tests/meeting-time-eat.test.mjs",
  "tests/meeting-registration-connectivity.test.mjs",
  "tests/meeting-configurable-quorum.test.mjs",
  "tests/meeting-quorum-reconciliation.test.mjs",
  "tests/meeting-portal-protection.test.mjs",
  "tests/meeting-portal-browser.test.mjs",
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
  "src/styles/signature-portal.css",
  "tests/signature-workflow-policy.test.mjs",
  "tests/signature-palette-signer-management.test.mjs",
  "tests/fixtures/meeting-portal-fixture.html",
  "tests/fixtures/meeting-portal-fixture.jsx",
  "tests/fixtures/meeting-portal-fixture.css",
  "tests/fixtures/mocks.js",
  "tests/meeting-portal-browser.test.mjs",
  "tests/meeting-room-authorization-boundary.test.mjs",
  // Explicitly permit the separate authenticated cross-portal mobile navigation race regression.
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
  "tests/communication-media-policy.test.mjs",
]);
// The production build flag may change only as part of the paired Signature Portal/Gateway integration.
const signaturePathwayContractRepair =
  changed.includes("src/components/ControlledDocumentUpload.jsx") &&
  changed.includes("src/components/SignaturePathwaySelfTest.jsx") &&
  changed.includes("src/firebase/data.js") &&
  changed.includes("src/firebase/signaturePlatform.js") &&
  changed.includes("src/firebase/signatureStorage.js") &&
  changed.includes("src/pages/SignaturePlatform.jsx") &&
  changed.includes("drive-gateway/src/index.js") &&
  changed.includes("tests/signature-pathway-contract.test.mjs") &&
  changed.every(path => allowed.has(path) || path === ".github/workflows/meeting-portal-fixture-browser.yml");
const signatureGatewayIntegration = changed.includes("src/firebase/signaturePlatform.js") &&
  changed.includes("drive-gateway/src/signing.mjs") &&
  changed.includes("drive-gateway/tests/controlled-authenticated-signing-flow.test.mjs");
const signatureSignerPickerRepair = changed.includes("src/pages/SignaturePlatform.jsx") &&
  changed.includes("src/firebase/signaturePlatform.js") &&
  changed.includes("tests/signature-signer-picker-regression.test.mjs");
const signaturePdfPaletteRepair = changed.includes("src/pages/SignaturePlatform.jsx") &&
  changed.includes("src/firebase/signatureStorage.js") &&
  changed.includes("tests/signature-workflow-policy.test.mjs") &&
  changed.every(path => [".github/workflows/meeting-portal-fixture-browser.yml", "tests/meeting-isolation-guard.test.mjs", "src/pages/SignaturePlatform.jsx", "src/firebase/signatureStorage.js", "tests/signature-workflow-policy.test.mjs"].includes(path));
const signatureSignerListVisibilityRepair = changed.includes("src/pages/SignaturePlatform.jsx") &&
  changed.includes("tests/signature-signer-picker-regression.test.mjs") &&
  changed.every(path => [".github/workflows/meeting-portal-fixture-browser.yml", "tests/meeting-isolation-guard.test.mjs", "src/pages/SignaturePlatform.jsx", "tests/signature-signer-picker-regression.test.mjs"].includes(path));
const signaturePaletteLifecycleSourceRepair = changed.includes("src/firebase/data.js") &&
  changed.includes("tests/signature-workflow-policy.test.mjs") &&
  changed.every(path => [".github/workflows/meeting-portal-fixture-browser.yml", "tests/meeting-isolation-guard.test.mjs", "src/firebase/data.js", "tests/signature-workflow-policy.test.mjs"].includes(path));
const signatureDocumentPaletteAssignmentRepair = changed.includes("src/pages/SignaturePlatform.jsx") &&
  changed.includes("src/firebase/data.js") &&
  changed.includes("firestore.rules") &&
  changed.includes("tests/signature-workflow-policy.test.mjs") &&
  changed.includes("tests/firestore.rules.test.cjs") &&
  changed.every(path => [".github/workflows/meeting-portal-fixture-browser.yml", "tests/meeting-isolation-guard.test.mjs", "src/pages/SignaturePlatform.jsx", "src/firebase/data.js", "firestore.rules", "tests/signature-workflow-policy.test.mjs", "tests/firestore.rules.test.cjs"].includes(path));
const signaturePaletteDirectAssignmentRepair =
  changed.includes("src/pages/SignaturePlatform.jsx") &&
  changed.includes("src/styles/signature-portal.css") &&
  changed.includes("tests/signature-workflow-policy.test.mjs") &&
  changed.includes("tests/signature-palette-signer-management.test.mjs") &&
  changed.includes("tests/signature-signer-picker-regression.test.mjs") &&
  changed.every(path => [".github/workflows/meeting-portal-fixture-browser.yml", "tests/meeting-isolation-guard.test.mjs", "src/pages/SignaturePlatform.jsx", "src/styles/signature-portal.css", "tests/signature-workflow-policy.test.mjs", "tests/signature-palette-signer-management.test.mjs", "tests/signature-signer-picker-regression.test.mjs"].includes(path));
const signaturePdfUrlHandoffRepair = changed.includes("src/pages/SignaturePlatform.jsx") &&
  changed.includes("tests/signature-workflow-policy.test.mjs") &&
  changed.every(path => [".github/workflows/meeting-portal-fixture-browser.yml", "tests/meeting-isolation-guard.test.mjs", "src/pages/SignaturePlatform.jsx", "tests/signature-workflow-policy.test.mjs"].includes(path));
const signaturePdfArchivePaletteRepair = changed.includes("src/firebase/data.js") &&
  changed.includes("src/pages/SignaturePlatform.jsx") &&
  changed.includes("tests/signature-workflow-policy.test.mjs") &&
  changed.every(path => [".github/workflows/meeting-portal-fixture-browser.yml", "tests/meeting-isolation-guard.test.mjs", "src/firebase/data.js", "src/pages/SignaturePlatform.jsx", "tests/signature-workflow-policy.test.mjs"].includes(path));
const controlledDocumentTrialUploadFix = changed.includes("firestore.rules") &&
  changed.includes("tests/firestore.rules.test.cjs") &&
  changed.every(path => allowed.has(path) || path === ".github/workflows/firebase-deploy.yml");
const actualDataGateIntegration = changed.includes("src/FieldEntryDataGate.jsx") &&
  changed.includes("src/firebase/systemControl.js") &&
  changed.includes("src/components/ActualDataAccessControl.jsx") &&
  changed.includes("functions/index.js") && changed.includes("firestore.rules") &&
  changed.includes("tests/firestore.rules.test.cjs") && changed.every(path => allowed.has(path) || path === ".github/workflows/firebase-deploy.yml");
// Grant AI document persistence is a separate, explicitly paired portal/rules change.
// Permit only its exact source, Firestore rules, and status-only readability adjustment;
// this does not exempt any meeting or invitation source from the isolation guard.
const grantAssistantPersistence = changed.includes("src/pages/GrantIntelligencePortal.jsx") &&
  changed.includes("firestore.rules") &&
  changed.every(path => [
    ".github/workflows/meeting-portal-fixture-browser.yml",
    "src/pages/GrantIntelligencePortal.jsx",
    "firestore.rules",
    "src/styles/app.css",
    "tests/firestore.rules.test.cjs"
  ].includes(path));
// Permit the dedicated Communications & Media integration only when its portal,
// Worker bridge, policy/browser tests, workflow, and docs are all paired. The two
// new page files remain disallowed for every other change set.
const existsAtHead = path => {
  try {
    execFileSync("git", ["cat-file", "-e", `HEAD:${path}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const communicationMediaPaths = new Set([
  ".github/workflows/communications-website-integration.yml",
  "docs/COMMUNICATION_MEDIA_PORTAL.md",
  "docs/COMMUNICATION_MEDIA_READINESS_CHECKLIST.md",
  "docs/META_OAUTH_STAGING.md",
  "drive-gateway/src/communicationsSite.mjs",
  "drive-gateway/src/metaOAuth.mjs",
  "drive-gateway/tests/staging-isolation.test.mjs",
  "drive-gateway/tests/website-content-editor.test.mjs",
  "src/pages/CommunicationMediaOperations.jsx",
  "src/pages/SocialMediaAccounts.jsx",
  "tests/meta-oauth-staging.test.mjs"
]);
const communicationMediaIntegration = changed.includes("src/pages/CommunicationMediaOperations.jsx") &&
  changed.includes("src/pages/SocialMediaAccounts.jsx") &&
  [
    "src/pages/CommunicationMediaPortal.jsx",
    "drive-gateway/src/communicationsSite.mjs",
    "drive-gateway/src/metaOAuth.mjs",
    "drive-gateway/tests/staging-isolation.test.mjs",
    "drive-gateway/tests/website-content-editor.test.mjs",
    "tests/communication-media-policy.test.mjs",
    "tests/meta-oauth-staging.test.mjs",
    ".github/workflows/communications-website-integration.yml",
    "docs/COMMUNICATION_MEDIA_PORTAL.md",
    "docs/COMMUNICATION_MEDIA_READINESS_CHECKLIST.md",
    "docs/META_OAUTH_STAGING.md"
  ].every(existsAtHead) &&
  !changed.includes("src/pages/Meetings.jsx") &&
  !changed.includes("src/pages/OperationalGatewaysParticipants.jsx") &&
  changed.every(path => allowed.has(path) || communicationMediaPaths.has(path));
const communicationMediaArchivePaths = new Set([
  "docs/COMMUNICATION_MEDIA_PORTAL.md",
  "drive-gateway/src/index.js",
  "drive-gateway/wrangler.toml",
  "src/firebase/signatureStorage.js",
  "src/pages/CommunicationMediaStudio.jsx",
  "drive-gateway/tests/staging-isolation.test.mjs",
  "firestore.rules",
  "tests/communication-media-policy.test.mjs"
]);
const communicationMediaArchiveIntegration =
  changed.includes("src/pages/CommunicationMediaStudio.jsx") &&
  changed.includes("tests/communication-media-policy.test.mjs") &&
  changed.includes("drive-gateway/src/index.js") &&
  changed.includes("drive-gateway/wrangler.toml") &&
  changed.includes("src/firebase/signatureStorage.js") &&
  changed.includes("firestore.rules") &&
  changed.includes("docs/COMMUNICATION_MEDIA_PORTAL.md") &&
  !changed.includes("src/pages/Meetings.jsx") &&
  !changed.includes("src/pages/OperationalGatewaysParticipants.jsx") &&
  changed.every(path => allowed.has(path) || communicationMediaArchivePaths.has(path));
// A parallel portal-window amendment may update only activeAmendment in the
// shared change record. All existing Meeting Portal and historical records
// must remain byte-equivalent after removing that one scoped property.
if (changed.includes("docs/portal-protection/change-record.json")) {
  const baselineRecord = JSON.parse(execFileSync("git", ["show", `${base}:docs/portal-protection/change-record.json`], { encoding: "utf8" }));
  const currentRecord = JSON.parse(execFileSync("git", ["show", "HEAD:docs/portal-protection/change-record.json"], { encoding: "utf8" }));
  delete baselineRecord.activeAmendment;
  delete currentRecord.activeAmendment;
  if (JSON.stringify(baselineRecord) !== JSON.stringify(currentRecord)) {
    throw new Error("Parallel repair-window amendment changed existing change-record history or another portal's record.");
  }
}
const baselineChangeRecord = JSON.parse(execFileSync("git", ["show", `${base}:docs/portal-protection/change-record.json`], { encoding: "utf8" }));
const currentChangeRecord = JSON.parse(execFileSync("git", ["show", "HEAD:docs/portal-protection/change-record.json"], { encoding: "utf8" }));
const baselineRepairWindow = JSON.parse(execFileSync("git", ["show", `${base}:docs/portal-protection/repair-window.json`], { encoding: "utf8" }));
const currentRepairWindow = JSON.parse(execFileSync("git", ["show", "HEAD:docs/portal-protection/repair-window.json"], { encoding: "utf8" }));
const parallelWindowDecision = evaluateSignatureWindowAmendment({
  changedPaths: changed,
  repairWindow: currentRepairWindow,
  changeRecord: currentChangeRecord,
  baselineChangeRecord,
  currentChangeRecord
});
const signatureWindowClosureDecision = evaluateSignatureWindowClosure({
  changedPaths: changed,
  baselineRepairWindow,
  currentRepairWindow,
  baselineChangeRecord,
  currentChangeRecord
});
const signatureWindowReopenDecision = evaluateSignatureWindowReopen({
  changedPaths: changed,
  baselineRepairWindow,
  currentRepairWindow,
  baselineChangeRecord,
  currentChangeRecord
});
const parallelWindowRecordAmendment = parallelWindowDecision.pass || signatureWindowClosureDecision.pass || signatureWindowReopenDecision.pass;
const signatureWindowRepairDecision = evaluateSignatureWindowRepair({
  changedPaths: changed,
  repairWindow: currentRepairWindow,
  changeRecord: currentChangeRecord,
  baselineChangeRecord,
  currentChangeRecord
});
const signatureEmailLinkSessionRepair = signatureWindowRepairDecision.pass;
if (changed.includes("docs/portal-protection/repair-window.json") ||
    changed.includes("docs/portal-protection/change-record.json")) {
  if (!parallelWindowRecordAmendment) throw new Error(signatureWindowReopenDecision.reason || signatureWindowClosureDecision.reason || parallelWindowDecision.reason);
}
// If Wrangler configuration changes, permit only the staging section to differ.
// The production section must be byte-for-byte identical to the captured PR base.
const wranglerPath = "drive-gateway/wrangler.toml";
if (changed.includes(wranglerPath)) {
  const readAt = ref => execFileSync("git", ["show", `${ref}:${wranglerPath}`], { encoding: "utf8" });
  const productionSection = (text, label) => {
    const marker = "\n[env.staging]";
    const first = text.indexOf(marker);
    if (first < 0 || text.indexOf(marker, first + marker.length) >= 0) {
      throw new Error(`${label} must contain exactly one [env.staging] boundary.`);
    }
    return text.slice(0, first);
  };
  const baselineConfig = readAt(base);
  const currentConfig = readAt("HEAD");
  if (productionSection(baselineConfig, "Baseline Wrangler config") !== productionSection(currentConfig, "Current Wrangler config")) {
    throw new Error("Production Wrangler configuration changed; only staging-only changes are permitted.");
  }
  const stagingConfig = currentConfig.slice(currentConfig.indexOf("\n[env.staging]"));
  if (!stagingConfig.includes('id = "5ea76010553049a2b98c8493c37fbbc4"')) {
    throw new Error("Staging DRIVE_KV must retain the explicitly approved dedicated namespace.");
  }
  if (stagingConfig.includes('id = "ccdbffa662ac48bfbdf7f4b1f62ca941"')) {
    throw new Error("Production DRIVE_KV cannot be used by staging.");
  }
}
const guardOnlyWorkflowRepair = changed.includes(".github/workflows/meeting-portal-fixture-browser.yml") &&
  changed.includes("tests/meeting-isolation-guard.test.mjs") &&
  changed.every(path => path === ".github/workflows/meeting-portal-fixture-browser.yml" || path === "tests/meeting-isolation-guard.test.mjs");
const testOnlySignatureNavigation = changed.includes("tests/meeting-portal-browser.test.mjs") &&
  changed.includes("tests/fixtures/meeting-portal-fixture.jsx");
const testOnlyRegisterScope = changed.includes("src/firebase/data.js") &&
  changed.includes("tests/meeting-category-policy.test.mjs");
// Shared-email signer identity repair is a narrowly scoped Signature Portal/Gateway
// integration. Keep the browser fixture guard active and require its paired source/tests.
const signatureEmailLinkIdentityPaths = new Set([
  "drive-gateway/src/index.js",
  "drive-gateway/src/signatureDraftPolicy.mjs",
  "drive-gateway/src/signing.mjs",
  "drive-gateway/tests/email-signing-links.integration.test.mjs",
  "drive-gateway/tests/email-signing-links.test.mjs",
  "drive-gateway/tests/signature-hardening-phase1.test.mjs",
  "src/firebase/signatureStorage.js",
  "src/pages/SignaturePlatform.jsx",
  "tests/signature-email-link-unification.test.mjs",
  "tests/signature-workflow-policy.test.mjs",
]);
const signatureEmailLinkIdentityRepair =
  changed.includes("src/firebase/signatureStorage.js") &&
  changed.includes("src/pages/SignaturePlatform.jsx") &&
  changed.includes("drive-gateway/src/signing.mjs") &&
  changed.includes("drive-gateway/src/signatureDraftPolicy.mjs") &&
  changed.includes("tests/signature-email-link-unification.test.mjs") &&
  changed.every(path => signatureEmailLinkIdentityPaths.has(path) ||
    path === ".github/workflows/meeting-portal-fixture-browser.yml");
const emailSigningRebuildPaths = new Set([
  "drive-gateway/src/emailSigningLinks.mjs", "drive-gateway/src/signing.mjs", "drive-gateway/src/index.js",
  "src/pages/EmailSigningReadOnlyPage.jsx", "src/pages/SignaturePlatform.jsx",
  "drive-gateway/tests/email-signing-contract.test.mjs", "drive-gateway/tests/email-signing-links.test.mjs",
  "drive-gateway/tests/email-signing-links.integration.test.mjs", "tests/email-signing-contract.test.mjs",
  ".github/workflows/email-signing-contract.yml"
]);
const emailSigningRebuildIntegration = changed.includes("drive-gateway/src/signing.mjs") &&
  changed.includes("drive-gateway/src/emailSigningLinks.mjs") &&
  changed.includes("drive-gateway/src/index.js") &&
  changed.includes("src/pages/EmailSigningReadOnlyPage.jsx") &&
  changed.includes("src/pages/SignaturePlatform.jsx") &&
  changed.includes("drive-gateway/tests/email-signing-contract.test.mjs") &&
  changed.some(path => path.startsWith("drive-gateway/src/emailSigning/")) &&
  changed.every(path => emailSigningRebuildPaths.has(path) || path.startsWith("drive-gateway/src/emailSigning/"));
const unexpected = changed.filter(path =>
  !allowed.has(path) && !(path === ".github/workflows/firebase-deploy.yml" && (signatureGatewayIntegration || actualDataGateIntegration || controlledDocumentTrialUploadFix)) &&
  !(communicationMediaIntegration && communicationMediaPaths.has(path)) &&
  !(communicationMediaArchiveIntegration && communicationMediaArchivePaths.has(path)) &&
  !(path === "drive-gateway/tests/esign-storage-multipart.test.mjs" && signatureGatewayIntegration) &&
  !(grantAssistantPersistence && ["src/pages/GrantIntelligencePortal.jsx", "src/styles/app.css"].includes(path)) &&
  !(signatureEmailLinkSessionRepair && changed.includes(path)) &&
  !(emailSigningRebuildIntegration && (emailSigningRebuildPaths.has(path) || path.startsWith("drive-gateway/src/emailSigning/")))
);
if (unexpected.length) {
  console.error("Unexpected files changed outside the isolated meeting repair:", unexpected);
  process.exit(1);
}

const invitationMailResendIntegration = changed.includes("public/administrator.html") &&
  changed.includes("src/firebase/auth.js") &&
  changed.includes("src/pages/Invitations.jsx") &&
  changed.includes("drive-gateway/src/index.js") &&
  changed.includes("drive-gateway/src/invitationEmail.mjs") &&
  changed.includes("drive-gateway/tests/mail-invitation.unit.mjs") &&
  changed.every(path => allowed.has(path));
const invitationRemovalIntegration = changed.includes("src/pages/Invitations.jsx") &&
  changed.includes("src/firebase/data.js") && changed.includes("functions/index.js") &&
  changed.includes("tests/invitation-removal-policy.test.mjs") &&
  changed.every(path => allowed.has(path));
// The signature migration PR is a separate, explicitly paired integration scope:
// require the portal bridge, Gateway signing implementation, and its authenticated flow test.

// Preserve the main-branch Communication & Media-only scope while keeping
// the signature integration explicitly paired to its own source and tests.
const communicationMediaOnly = communicationMediaIntegration || communicationMediaArchiveIntegration ||
  (changed.includes("src/pages/CommunicationMediaPortal.jsx") &&
    changed.includes("src/pages/CommunicationMediaStudio.jsx") &&
    changed.includes("tests/communication-media-policy.test.mjs") &&
    !changed.includes("src/pages/Meetings.jsx") &&
    !changed.includes("src/pages/OperationalGatewaysParticipants.jsx") &&
    changed.every(path => allowed.has(path)));
// Readability-only PRs may change the shared stylesheet, its dedicated tests, and explicit CI path filters.
// The exception excludes portal business logic, meeting UI, auth logic and deployment configuration.
const readabilityOnlyFiles = new Set([
  ".github/workflows/authenticated-governance-browser-fixture.yml",
  ".github/workflows/cloudflare-esignature-tests.yml",
  ".github/workflows/document-lifecycle-module-test.yml",
  ".github/workflows/document-translation-workspace-test.yml",
  ".github/workflows/fundraising-responsive-smoke.yml",
  ".github/workflows/mail-invitation-tests.yml",
  ".github/workflows/meeting-invitation-flow-ci.yml",
  ".github/workflows/meeting-invitation-nonprod-e2e.yml",
  ".github/workflows/meeting-media-governance.yml",
  ".github/workflows/meeting-portal-fixture-browser.yml",
  ".github/workflows/meeting-room-ai-assistant-verification.yml",
  ".github/workflows/meeting-room-authorization-boundary.yml",
  ".github/workflows/pdf-esignature-tests.yml",
  ".github/workflows/portal-navigation-regression.yml",
  ".github/workflows/readability-release-gate.yml",
  "package.json",
  "src/App.jsx",
  "src/styles/portal-readability-standard.css",
  "tests/browser/authenticated-governance-regression.spec.mjs",
  "tests/meeting-isolation-guard.test.mjs",
  "tests/portal-readability-standard.test.mjs"
]);
// package.json may change only to register the dedicated readability test script.
let packageJsonReadabilityOnly = !changed.includes("package.json");
if (changed.includes("package.json")) {
  const baselinePackage = JSON.parse(execFileSync("git", ["show", `${base}:package.json`], { encoding: "utf8" }));
  const currentPackage = JSON.parse(execFileSync("git", ["show", "HEAD:package.json"], { encoding: "utf8" }));
  const removeReadabilityScript = value => {
    const copy = structuredClone(value);
    delete copy.scripts?.["test:portal-readability-standard"];
    return copy;
  };
  packageJsonReadabilityOnly =
    currentPackage.scripts?.["test:portal-readability-standard"] === "node --test tests/portal-readability-standard.test.mjs" &&
    baselinePackage.scripts?.["test:portal-readability-standard"] === undefined &&
    JSON.stringify(removeReadabilityScript(baselinePackage)) === JSON.stringify(removeReadabilityScript(currentPackage));
}
const readabilityOnlyChange = changed.includes("src/styles/portal-readability-standard.css") &&
  changed.every(path => readabilityOnlyFiles.has(path)) && packageJsonReadabilityOnly;
// A manual dispatch on an already-merged ref is a regression rerun, not a PR diff.
// Keep the changed-path isolation guard, but require a source/test delta only for event diffs.
const meetingTrialDeletionFiles = new Set([
  "docs/implementation-status.md",
  "docs/portal-protection/records/meeting-portal.json",
  "docs/portal-protection/windows/meeting-portal.json",
  "drive-gateway/src/meetingEnvironment.mjs",
  "drive-gateway/src/meetingDeletion.mjs",
  "drive-gateway/src/meetingServices.mjs",
  "drive-gateway/tests/meeting-trial-deletion.test.mjs",
  "drive-gateway/tests/meeting-environment.test.mjs",
  "scripts/meeting-portal-fixture-isolation-guard.sh",
  "scripts/portal-protection-check.mjs",
  "tests/meeting-isolation-guard.test.mjs",
  "tests/meeting-trial-delete-ui.test.mjs",
  "tests/portal-protection-policy.test.mjs",
  "src/pages/Meetings.jsx"
]);
const meetingTrialDeletionGuard =
  changed.includes("drive-gateway/src/meetingServices.mjs") &&
  changed.includes("drive-gateway/src/meetingEnvironment.mjs") &&
  changed.includes("drive-gateway/src/meetingDeletion.mjs") &&
  changed.includes("drive-gateway/tests/meeting-environment.test.mjs") &&
  changed.includes("drive-gateway/tests/meeting-trial-deletion.test.mjs") &&
  changed.includes("src/pages/Meetings.jsx") &&
  changed.includes("tests/meeting-trial-delete-ui.test.mjs") &&
  changed.includes("tests/meeting-isolation-guard.test.mjs") &&
  changed.includes("tests/portal-protection-policy.test.mjs") &&
  changed.every(path => meetingTrialDeletionFiles.has(path));
if (!isMainPush && eventName !== "workflow_dispatch" &&
    !changed.includes("src/pages/Meetings.jsx") &&
    !changed.includes("src/pages/OperationalGatewaysParticipants.jsx") &&
    !testOnlySignatureNavigation && !testOnlyRegisterScope && !invitationRemovalIntegration && !invitationMailResendIntegration &&
    !signatureGatewayIntegration && !signaturePathwayContractRepair && !actualDataGateIntegration && !controlledDocumentTrialUploadFix && !signatureSignerPickerRepair && !signatureSignerListVisibilityRepair && !signaturePdfPaletteRepair && !signaturePaletteDirectAssignmentRepair && !signaturePdfUrlHandoffRepair && !signatureDocumentPaletteAssignmentRepair && !signaturePaletteLifecycleSourceRepair && !signaturePdfArchivePaletteRepair && !signatureEmailLinkIdentityRepair && !guardOnlyWorkflowRepair && !communicationMediaOnly && !readabilityOnlyChange && !grantAssistantPersistence && !meetingTrialDeletionGuard && !parallelWindowRecordAmendment && !signatureEmailLinkSessionRepair && !emailSigningRebuildIntegration) {
  throw new Error("Meeting/participant source change or an explicitly paired isolated regression/guard test is missing.");
}
console.log(JSON.stringify({ result: "PASS", changedFiles: changed, unrelatedPortalSourceChanges: 0 }));
NODE

# Keep the shared isolation guard in the five-file portal-window amendment contract.
