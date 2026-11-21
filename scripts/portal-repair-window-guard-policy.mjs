export const SIGNATURE_WINDOW_AMENDMENT_PATHS = Object.freeze([
  "docs/portal-protection/repair-window.json",
  "docs/portal-protection/change-record.json",
  "scripts/meeting-portal-fixture-isolation-guard.sh",
  "scripts/portal-repair-window-guard-policy.mjs",
  "tests/meeting-isolation-guard.test.mjs"
]);

export function evaluateSignatureWindowAmendment({
  changedPaths, repairWindow, changeRecord, baselineChangeRecord,
  currentChangeRecord, now = new Date()
}) {
  const changed = [...new Set(changedPaths)].sort();
  const expected = [...SIGNATURE_WINDOW_AMENDMENT_PATHS].sort();
  if (JSON.stringify(changed) !== JSON.stringify(expected)) {
    return { pass: false, reason: "Change set is not limited to the separate Signature Portal window amendment." };
  }
  const signatureWindow = repairWindow?.parallelWindows?.find(item => item.portal === "Signature Portal");
  if (!signatureWindow || signatureWindow.status !== "open") {
    return { pass: false, reason: "Signature Portal repair window is not open." };
  }
  const expiry = Date.parse(signatureWindow.closesAt || "");
  if (!Number.isFinite(expiry) || now.getTime() >= expiry) {
    return { pass: false, reason: "Signature Portal repair window has expired." };
  }
  const amendment = changeRecord?.activeAmendment;
  if (!amendment || amendment.status !== "open" ||
      !Array.isArray(amendment.files) ||
      !amendment.files.includes("drive-gateway/src/signing.mjs")) {
    return { pass: false, reason: "Protected Signature Portal changes require an active Change Record." };
  }
  const strip = value => {
    const copy = structuredClone(value);
    delete copy.activeAmendment;
    return copy;
  };
  if (JSON.stringify(strip(baselineChangeRecord)) !== JSON.stringify(strip(currentChangeRecord))) {
    return { pass: false, reason: "Another portal's window or existing Change Record history was altered." };
  }
  const expectedRollback = "eb04405e4ec2d64e45d016b6ed3adbc2e8136fbd";
  const expectedFrontendRollback = "eb68a06fdd04454b0e73d2dc9c010eae5519f458";
  if (signatureWindow.rollbackCommit !== expectedRollback ||
      amendment.repairWindow?.rollbackCommit !== expectedRollback ||
      signatureWindow.frontendRollbackCommit !== expectedFrontendRollback ||
      amendment.repairWindow?.frontendRollbackCommit !== expectedFrontendRollback) {
    return { pass: false, reason: "Signature Portal Worker or frontend rollback reference does not match the recorded production baseline." };
  }
  return { pass: true, reason: "Only the separate Signature Portal window amendment is permitted." };
}

export function protectedSignatureChangeHasRecord({ changedPaths, changeRecord }) {
  const protectedPaths = [
    "drive-gateway/src/signing.mjs",
    "drive-gateway/src/emailSigningLinks.mjs",
    "drive-gateway/src/index.js",
    "drive-gateway/src/router.mjs",
    "src/pages/EmailSigningReadOnlyPage.jsx",
    "src/pages/SignaturePlatform.jsx"
  ];
  const touchesProtected = changedPaths.some(path => protectedPaths.includes(path) ||
    path.startsWith("drive-gateway/src/emailSigning/") || path.startsWith("drive-gateway/tests/") || path.startsWith("tests/"));
  return !touchesProtected || Boolean(changeRecord?.activeAmendment?.status === "open");
}


export function evaluateSignatureWindowRepair({
  changedPaths, repairWindow, changeRecord, baselineChangeRecord,
  currentChangeRecord, now = new Date()
}) {
  const changed = [...new Set(changedPaths)];
  const amendment = changeRecord?.activeAmendment;
  const window = repairWindow?.parallelWindows?.find(item => item.portal === "Signature Portal");
  if (!amendment || amendment.status !== "open" || !Array.isArray(amendment.files) ||
      !window || window.status !== "open") {
    return { pass: false, reason: "The Signature Portal repair window or its Change Record is not active." };
  }
  const expiry = Date.parse(window.closesAt || "");
  if (!Number.isFinite(expiry) || now.getTime() >= expiry) {
    return { pass: false, reason: "The Signature Portal repair window has expired." };
  }
  const rollbackMode = amendment.operation === "restore-pre-11-eat-baseline";
  const required = rollbackMode ? [
    "drive-gateway/src/signing.mjs", "drive-gateway/src/router.mjs", "drive-gateway/src/index.js",
    "src/pages/EmailSigningReadOnlyPage.jsx", "src/pages/SignaturePlatform.jsx",
    "drive-gateway/src/emailSigning/index.mjs", "drive-gateway/tests/email-signing-contract.test.mjs",
    ".github/workflows/email-signing-contract.yml", "drive-gateway/tests/email-signing-links.integration.test.mjs"
  ] : [
    "drive-gateway/src/signing.mjs", "drive-gateway/src/emailSigningLinks.mjs", "drive-gateway/src/index.js",
    "src/pages/EmailSigningReadOnlyPage.jsx", "src/pages/SignaturePlatform.jsx",
    "drive-gateway/tests/email-signing-contract.test.mjs"
  ];
  if (!required.every(path => changed.includes(path)) ||
      (!rollbackMode && !changed.some(path => path.startsWith("drive-gateway/src/emailSigning/")))) {
    return { pass: false, reason: "The repair is missing its scoped implementation or end-to-end regression test." };
  }
  if (amendment.repairWindow?.rollbackCommit !== window.rollbackCommit) {
    return { pass: false, reason: "The active Change Record rollback target does not match the verified Signature Portal window baseline." };
  }
  const maintenance = new Set([
    "scripts/meeting-portal-fixture-isolation-guard.sh",
    "scripts/portal-repair-window-guard-policy.mjs",
    "tests/meeting-isolation-guard.test.mjs"
  ]);
  const inScope = path => amendment.files.some(scope =>
    scope.endsWith("/") ? path.startsWith(scope) : path === scope
  );
  if (!changed.every(path => inScope(path) || maintenance.has(path))) {
    return { pass: false, reason: "The repair changes a file outside the active Signature Portal window." };
  }
  const strip = value => {
    const copy = structuredClone(value);
    delete copy.activeAmendment;
    return copy;
  };
  if (JSON.stringify(strip(baselineChangeRecord)) !== JSON.stringify(strip(currentChangeRecord))) {
    return { pass: false, reason: "The repair changed another portal's window or historical Change Record." };
  }
  return { pass: true, reason: "Repair is limited to the active Signature Portal window." };
}


export function evaluateSignatureWindowClosure({
  changedPaths, baselineRepairWindow, currentRepairWindow,
  baselineChangeRecord, currentChangeRecord, now = new Date()
}) {
  const changed = [...new Set(changedPaths)].sort();
  const expected = [...SIGNATURE_WINDOW_AMENDMENT_PATHS].sort();
  if (JSON.stringify(changed) !== JSON.stringify(expected)) {
    return { pass: false, reason: "Window closure must be a separate five-file Change Record amendment." };
  }
  const baselineSignature = baselineRepairWindow?.parallelWindows?.find(item => item.portal === "Signature Portal");
  const currentSignature = currentRepairWindow?.parallelWindows?.find(item => item.portal === "Signature Portal");
  const meetingWindows = doc => (doc?.parallelWindows || []).filter(item => item.portal !== "Signature Portal");
  if (JSON.stringify(meetingWindows(baselineRepairWindow)) !== JSON.stringify(meetingWindows(currentRepairWindow))) {
    return { pass: false, reason: "Closing the Signature Portal window changed the independent Meeting Portal window." };
  }
  const stripSignature = item => {
    const copy = structuredClone(item);
    for (const key of ["status", "closedAt", "lastActivityAt", "closureEvidence", "activityLog"]) delete copy[key];
    return copy;
  };
  if (!baselineSignature || baselineSignature.status !== "open" ||
      !currentSignature || currentSignature.status !== "closed" ||
      !currentSignature.closedAt || !currentSignature.closureEvidence) {
    return { pass: false, reason: "The Signature Portal window is not being closed with completion evidence." };
  }
  if (JSON.stringify(stripSignature(baselineSignature)) !== JSON.stringify(stripSignature(currentSignature))) {
    return { pass: false, reason: "The Signature Portal scope, rollback reference, or prohibitions changed during closure." };
  }
  const baselineActivity = baselineSignature.activityLog || [];
  const currentActivity = currentSignature.activityLog || [];
  if (currentActivity.length !== baselineActivity.length + 1 ||
      JSON.stringify(currentActivity.slice(0, baselineActivity.length)) !== JSON.stringify(baselineActivity) ||
      currentActivity.at(-1)?.action !== "closed") {
    return { pass: false, reason: "The Signature Portal activity history was rewritten instead of appended with one closure record." };
  }
  const baselineAmendment = baselineChangeRecord?.activeAmendment;
  const currentAmendment = currentChangeRecord?.activeAmendment;
  const stripAmendment = item => {
    const copy = structuredClone(item);
    for (const key of ["status", "closedAt", "completion"]) delete copy[key];
    return copy;
  };
  if (!baselineAmendment || baselineAmendment.status !== "open" ||
      !currentAmendment || currentAmendment.status !== "closed" ||
      !currentAmendment.closedAt || !currentAmendment.completion) {
    return { pass: false, reason: "The active Change Record is not being closed with merge, deployment and smoke evidence." };
  }
  if (JSON.stringify(stripAmendment(baselineAmendment)) !== JSON.stringify(stripAmendment(currentAmendment))) {
    return { pass: false, reason: "The Signature Portal Change Record scope or original authorisation changed during closure." };
  }
  const stripOtherHistory = value => {
    const copy = structuredClone(value);
    delete copy.activeAmendment;
    return copy;
  };
  if (JSON.stringify(stripOtherHistory(baselineChangeRecord)) !== JSON.stringify(stripOtherHistory(currentChangeRecord))) {
    return { pass: false, reason: "Closing the Signature Portal amendment changed another portal's Change Record or history." };
  }
  const closedAt = Date.parse(currentSignature.closedAt);
  if (!Number.isFinite(closedAt) || closedAt > now.getTime() + 5 * 60 * 1000) {
    return { pass: false, reason: "The Signature Portal closure timestamp is invalid." };
  }
  return { pass: true, reason: "Only the completed Signature Portal repair window and its Change Record were closed." };
}


export function evaluateSignatureWindowReopen({
  changedPaths, baselineRepairWindow, currentRepairWindow,
  baselineChangeRecord, currentChangeRecord, now = new Date()
}) {
  const changed = [...new Set(changedPaths)].sort();
  const expected = [...SIGNATURE_WINDOW_AMENDMENT_PATHS].sort();
  if (JSON.stringify(changed) !== JSON.stringify(expected)) {
    return { pass: false, reason: "Reopening must be a separate five-file Signature Portal Change Record amendment." };
  }
  const baselineSignature = baselineRepairWindow?.parallelWindows?.find(item => item.portal === "Signature Portal");
  const currentSignature = currentRepairWindow?.parallelWindows?.find(item => item.portal === "Signature Portal");
  const meetingWindows = doc => (doc?.parallelWindows || []).filter(item => item.portal !== "Signature Portal");
  if (JSON.stringify(meetingWindows(baselineRepairWindow)) !== JSON.stringify(meetingWindows(currentRepairWindow))) {
    return { pass: false, reason: "Reopening the Signature Portal window changed the independent Meeting Portal window." };
  }
  if (!baselineSignature || baselineSignature.status !== "closed" ||
      !currentSignature || currentSignature.status !== "open" ||
      !currentSignature.reopenedAt || !currentSignature.closesAt ||
      Date.parse(currentSignature.closesAt) <= now.getTime()) {
    return { pass: false, reason: "The Signature Portal window was not reopened within its original authorised period." };
  }
  const stripSignature = item => {
    const copy = JSON.parse(JSON.stringify(item));
    for (const key of ["status", "closedAt", "reopenedAt", "lastActivityAt", "closureEvidence", "activityLog"]) delete copy[key];
    return copy;
  };
  if (JSON.stringify(stripSignature(baselineSignature)) !== JSON.stringify(stripSignature(currentSignature))) {
    return { pass: false, reason: "Reopening changed the authorised Signature Portal scope, rollback reference, or prohibitions." };
  }
  const baselineActivity = baselineSignature.activityLog || [];
  const currentActivity = currentSignature.activityLog || [];
  if (currentActivity.length !== baselineActivity.length + 1 ||
      JSON.stringify(currentActivity.slice(0, baselineActivity.length)) !== JSON.stringify(baselineActivity) ||
      currentActivity.at(-1)?.action !== "reopened") {
    return { pass: false, reason: "The prior closure history was not preserved and followed by one reopen event." };
  }
  const baselineAmendment = baselineChangeRecord?.activeAmendment;
  const currentAmendment = currentChangeRecord?.activeAmendment;
  const stripAmendment = item => {
    const copy = JSON.parse(JSON.stringify(item));
    for (const key of ["status", "closedAt", "completion", "priorClosure", "reopenedAt", "reopenReason"]) delete copy[key];
    return copy;
  };
  if (!baselineAmendment || baselineAmendment.status !== "closed" ||
      !currentAmendment || currentAmendment.status !== "open" ||
      currentAmendment.ownerInstruction !== "Execute the complete Email Signing rebuild on feat/email-signing-rebuild-20261120." ||
      !currentAmendment.reopenedAt || !currentAmendment.priorClosure) {
    return { pass: false, reason: "The full owner-authorised Email Signing rebuild is not recorded as the active amendment." };
  }
  if (JSON.stringify(stripAmendment(baselineAmendment)) !== JSON.stringify(stripAmendment(currentAmendment))) {
    return { pass: false, reason: "Reopening changed the owner-authorised rebuild scope or original prohibitions." };
  }
  const expectedPriorClosure = {
    closedAt: baselineAmendment.closedAt,
    completion: baselineAmendment.completion,
    closedByPR: 820
  };
  if (JSON.stringify(currentAmendment.priorClosure) !== JSON.stringify(expectedPriorClosure)) {
    return { pass: false, reason: "The previous closure evidence was not preserved as historical record." };
  }
  const stripOtherHistory = value => {
    const copy = JSON.parse(JSON.stringify(value));
    delete copy.activeAmendment;
    return copy;
  };
  if (JSON.stringify(stripOtherHistory(baselineChangeRecord)) !== JSON.stringify(stripOtherHistory(currentChangeRecord))) {
    return { pass: false, reason: "Reopening changed another portal's Change Record or history." };
  }
  const closedAt = Date.parse(currentSignature.reopenedAt);
  if (!Number.isFinite(closedAt) || closedAt > now.getTime() + 5 * 60 * 1000) {
    return { pass: false, reason: "The Signature Portal reopen timestamp is invalid." };
  }
  return { pass: true, reason: "Only the previously closed Signature Portal full-rebuild amendment was reopened, with history preserved." };
}
