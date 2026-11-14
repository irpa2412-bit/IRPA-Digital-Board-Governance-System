const scalarAuthorityFields = [
  "role", "boardPosition", "designation", "jobTitle", "position", "title",
  "authorityRole", "unit", "unitName"
];
const arrayAuthorityFields = ["roles", "assignedRoles", "selectedRoles", "roleAssignments"];

export function normalizeManualAuthority(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/^(the|irpa)\s+/, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Preserve the old plural UI spelling as a display/input compatibility form;
  // do not collapse any of the ambiguous director titles.
  return normalized === "board members" ? "board member" : normalized;
}

function valuesFromAuthorityEntry(record = {}) {
  const scalar = scalarAuthorityFields.map(field => record?.[field]);
  const arrays = arrayAuthorityFields.flatMap(field => {
    const values = Array.isArray(record?.[field]) ? record[field] : [];
    return values.flatMap(value => {
      if (typeof value === "string" || typeof value === "number") return [value];
      if (value && typeof value === "object") {
        return [value.role, value.title, value.designation, value.position].filter(Boolean);
      }
      return [];
    });
  });
  return [...scalar, ...arrays]
    .filter(value => typeof value === "string" || typeof value === "number")
    .flatMap(value => String(value).split(",").map(item => item.trim()).filter(Boolean));
}

export function authorityCandidates(record = {}) {
  return valuesFromAuthorityEntry(record).map(normalizeManualAuthority).filter(Boolean);
}

export function findManualAuthorityMatch(entries, manualAuthorityIdentification) {
  const input = normalizeManualAuthority(manualAuthorityIdentification);
  if (!input) return null;
  return (Array.isArray(entries) ? entries : []).find(entry => authorityCandidates(entry).includes(input)) || null;
}

export function resolveManualAuthorityLabel(record, manualAuthorityIdentification) {
  const input = normalizeManualAuthority(manualAuthorityIdentification);
  return valuesFromAuthorityEntry(record).find(value => normalizeManualAuthority(value) === input)
    || String(manualAuthorityIdentification || "").trim();
}
