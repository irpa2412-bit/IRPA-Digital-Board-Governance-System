const SCALAR_FIELDS = [
  "role", "boardPosition", "designation", "jobTitle", "position", "title",
  "authorityRole", "unit", "unitName"
];
const ARRAY_FIELDS = ["roles", "assignedRoles", "selectedRoles", "roleAssignments"];

export function normalizeGatewayAuthority(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/^(the|irpa)\\s+/, "")
    .replace(/[._-]+/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
  return normalized === "board members" ? "board member" : normalized;
}

export function gatewayAuthorityValues(record = {}) {
  const scalar = SCALAR_FIELDS.map(field => record?.[field]);
  const arrays = ARRAY_FIELDS.flatMap(field => {
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

export function gatewayAuthorityCandidates(record = {}) {
  return gatewayAuthorityValues(record).map(normalizeGatewayAuthority).filter(Boolean);
}

export function resolveGatewayAuthorityLabel(record = {}, requestedAuthority = "") {
  const input = normalizeGatewayAuthority(requestedAuthority);
  return gatewayAuthorityValues(record).find(value => normalizeGatewayAuthority(value) === input) || null;
}
