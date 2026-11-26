const normalizeLabel = value => {
  const label = String(value ?? "").trim().toUpperCase();
  if (!label) return null;
  if (label === "TRIAL") return "TRIAL";
  if (label === "ACTUAL" || label === "PRODUCTION") return "ACTUAL";
  return "UNKNOWN";
};

const booleanLabel = value => {
  if (value === true || String(value).trim().toLowerCase() === "true") return "TRIAL";
  if (value === false || String(value).trim().toLowerCase() === "false") return "ACTUAL";
  return null;
};

/**
 * Resolve a signing record's environment from every supported persisted marker.
 * Missing and conflicting metadata fail closed to UNKNOWN.
 */
export function normalizeSignatureEnvironment(record = {}) {
  const candidates = [
    ["recordOrigin", normalizeLabel(record.recordOrigin)],
    ["dataEnvironment", normalizeLabel(record.dataEnvironment)],
    ["trialData", booleanLabel(record.trialData)],
    ["isTrial", booleanLabel(record.isTrial)]
  ].filter(([, value]) => value !== null);

  const known = candidates.map(([, value]) => value).filter(value => value !== "UNKNOWN");
  const unknownMarker = candidates.some(([, value]) => value === "UNKNOWN");
  const distinct = [...new Set(known)];
  if (unknownMarker || distinct.length !== 1) {
    return { environment: "UNKNOWN", conflict: distinct.length > 1, sources: candidates.map(([source]) => source) };
  }
  return { environment: distinct[0], conflict: false, sources: candidates.map(([source]) => source) };
}
