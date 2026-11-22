export const ACTUAL_DATA_ATTESTATION = "I CONFIRM FINAL SYSTEM TESTS PASSED";

export function evaluateActualDataAccessPolicy({ adminAllowed, enabled, confirmation }) {
  if (adminAllowed !== true) return { allowed: false, status: 403, step: "Administrator authorization", error: "Only an active IRPA Administrator may change actual-data access." };
  if (typeof enabled !== "boolean") return { allowed: false, status: 400, step: "Validate request and attestation", error: "An enabled boolean is required." };
  if (enabled && confirmation !== ACTUAL_DATA_ATTESTATION) return { allowed: false, status: 412, step: "Validate request and attestation", error: "Opening actual-data access requires the exact final-test attestation." };
  return { allowed: true, status: 200, enabled, finalTestsAttested: enabled };
}
