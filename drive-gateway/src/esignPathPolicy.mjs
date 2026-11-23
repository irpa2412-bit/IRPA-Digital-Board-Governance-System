export const RECOVERY_ENVELOPE_ID_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;
export const RECOVERY_EVIDENCE_PATH_PATTERN = /^\/api\/recovery\/envelopes\/([A-Za-z0-9_-]{3,64})\/evidence$/;

export function matchRecoveryEvidenceRoute(method, pathname) {
  if (method !== "GET") return null;
  return String(pathname || "").match(RECOVERY_EVIDENCE_PATH_PATTERN);
}

export function isEsignPath(pathname) {
  const path = String(pathname || "");
  return path === "/api/documents/next-reference" ||
    /^\/api\/documents(?:\/.*)?$/.test(path) ||
    /^\/api\/envelopes(?:\/[A-Za-z0-9_-]{3,64}(?:\/(?:status|resync|retry|retry-completion|void|distribution\/retry|diagnose-finalisation)|\/invitations\/S\d+\/(?:resend|revoke))?)?$/.test(path) ||
    /^\/api\/sign\/.*$/.test(path) ||
    /^\/api\/document-lifecycle\/.*$/.test(path) ||
    /^\/api\/auth\/.*$/.test(path) ||
    path === "/api/recovery/envelopes" ||
    /^\/api\/recovery\/envelopes\/[A-Za-z0-9_-]{3,64}\/(?:evidence|preview\.pdf|completed-copy\.pdf|emergency-retrieval)$/.test(path) ||
    /^\/api\/recovery\/envelopes\/[A-Za-z0-9_-]{3,64}\/stamps\/reassign$/.test(path);
}
