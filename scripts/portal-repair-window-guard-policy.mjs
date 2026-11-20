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
  const expectedRollback = "fd3e5c8580c28d0c00f2ad0ca1c62e0131abafb8";
  if (signatureWindow.rollbackCommit !== expectedRollback ||
      amendment.repairWindow?.rollbackCommit !== expectedRollback) {
    return { pass: false, reason: "Signature Portal rollback reference does not match the latest successful production Worker deploy." };
  }
  return { pass: true, reason: "Only the separate Signature Portal window amendment is permitted." };
}

export function protectedSignatureChangeHasRecord({ changedPaths, changeRecord }) {
  const protectedPaths = [
    "drive-gateway/src/signing.mjs",
    "drive-gateway/src/emailSigningLinks.mjs",
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
