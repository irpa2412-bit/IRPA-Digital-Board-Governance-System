const clean = value => String(value ?? "").trim();
const lower = value => clean(value).toLowerCase();
const normaliseWords = value => lower(value).replace(/[._-]+/g, " ").replace(/\\s+/g, " ").trim();

export const MEETING_AUTHORITY_ROLES = Object.freeze({
  OVERSIGHT: "Director of Internal Oversight",
  EXECUTIVE: "Executive Director",
  DEPARTMENT_HEAD: "Head of Department"
});

export function normalizeMeetingRole(value) {
  const role = normaliseWords(value);
  if (["director of internal oversight", "internal oversight director", "director of international oversight"].includes(role)) {
    return MEETING_AUTHORITY_ROLES.OVERSIGHT;
  }
  if (role === "executive director") return MEETING_AUTHORITY_ROLES.EXECUTIVE;
  if (/head of department|hod/.test(role)) return MEETING_AUTHORITY_ROLES.DEPARTMENT_HEAD;
  return clean(value).replace(/\\s+/g, " ");
}

const inactiveStatuses = new Set(["inactive", "disabled", "suspended", "expired", "revoked", "removed", "cancelled", "canceled", "terminated"]);
function isActive(record, now) {
  if (!record || record.active === false || record.revoked === true || record.revokedAt || record.deleted === true) return false;
  const statuses = [record.status, record.employmentStatus, record.registrationStatus, record.authorityStatus]
    .filter(Boolean).map(normaliseWords);
  if (statuses.some(status => inactiveStatuses.has(status))) return false;
  const expiry = record.expiresAt || record.expiryDate || record.validUntil || record.endDate;
  if (expiry && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) <= now) return false;
  const start = record.effectiveFrom || record.validFrom || record.startDate;
  if (start && Number.isFinite(Date.parse(start)) && Date.parse(start) > now) return false;
  return record.active === true || statuses.some(status => ["active", "activated", "approved", "current", "valid"].includes(status));
}
const values = value => Array.isArray(value) ? value : value == null ? [] : [value];
const first = (...items) => items.find(value => value != null && clean(value)) ?? "";
function recordIdentifiers(record = {}) {
  const id = clean(record.id);
  return {
    uid: [record.uid, record.authUid, record.userUid, record.firebaseUid, record.firebaseAuthUid, record.linkedUid].map(clean).filter(Boolean),
    email: [record.email, record.emailAddress, record.contactEmail, record.officialEmail].map(lower).filter(Boolean),
    memberNumber: [record.memberNumber, record.registrationNumber, record.membershipNumber, /^IRPA-MEM-/i.test(id) ? id : ""].map(clean).filter(Boolean),
    employeeNumber: [record.employeeNumber, record.employeeId, record.staffNumber, /^IRPA-EMP-/i.test(id) ? id : ""].map(clean).filter(Boolean)
  };
}
function callerIdentifiers(caller = {}) {
  return {
    uid: [caller.uid, caller.user_id, caller.authUid].map(clean).filter(Boolean),
    email: [caller.email, caller.emailAddress].map(lower).filter(Boolean),
    memberNumber: values(caller.memberNumbers ?? caller.memberNumber).map(clean).filter(Boolean),
    employeeNumber: values(caller.employeeNumbers ?? caller.employeeNumber).map(clean).filter(Boolean)
  };
}
const keyNames = ["uid", "email", "memberNumber", "employeeNumber"];
function intersects(recordKeys, keys) {
  return keyNames.some(key => recordKeys[key].some(value => keys[key].has(value)));
}
function addKeys(recordKeys, keys) {
  let changed = false;
  for (const key of keyNames) for (const value of recordKeys[key]) {
    if (!keys[key].has(value)) { keys[key].add(value); changed = true; }
  }
  return changed;
}
function rolesOf(record = {}) {
  const candidates = [
    ...values(record.roles), record.role, ...values(record.assignedRoles), ...values(record.positions),
    record.position, record.jobTitle, record.title, record.designation, record.authority,
    record.boardPosition, ...values(record.authorities), ...values(record.accessCategories)
  ];
  if (record.isHeadOfDepartment === true || record.isDepartmentHead === true || record.headOfDepartment === true || record.isHod === true) {
    candidates.push(MEETING_AUTHORITY_ROLES.DEPARTMENT_HEAD);
  }
  return candidates.filter(value => typeof value === "string").flatMap(value => value.split(","))
    .map(normalizeMeetingRole).filter(Boolean);
}
function isGrantRole(role) {
  return Object.values(MEETING_AUTHORITY_ROLES).includes(normalizeMeetingRole(role));
}
function departmentHeadMatches(department, keys) {
  const head = {
    uid: [department.headUid, department.headOfDepartmentUid, department.departmentHeadUid, department.managerUid].map(clean).filter(Boolean),
    email: [department.headEmail, department.headOfDepartmentEmail, department.departmentHeadEmail, department.managerEmail].map(lower).filter(Boolean),
    memberNumber: [department.headMemberNumber, department.headOfDepartmentMemberNumber].map(clean).filter(Boolean),
    employeeNumber: [department.headEmployeeNumber, department.headOfDepartmentEmployeeNumber].map(clean).filter(Boolean)
  };
  return intersects(head, keys);
}
async function readCollection(ctx, env, token, collection) {
  if (typeof ctx.getMeetingAuthorityRegisters === "function") {
    const registers = await ctx.getMeetingAuthorityRegisters({ env, token });
    if (!registers || !Array.isArray(registers.members) || !Array.isArray(registers.employees)) {
      throw new Error("Members or Employees register was not returned.");
    }
    return collection === "members" ? registers.members :
      collection === "employees" ? registers.employees : (registers.departments || []);
  }
  if (typeof ctx.listCollection === "function") {
    return await ctx.listCollection(env, token, collection);
  }
  const projectId = typeof ctx.getFirebaseProjectId === "function" ? ctx.getFirebaseProjectId(env) : "";
  if (!projectId || !token) throw new Error("Firebase project identity or Firestore admin token is unavailable.");
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], limit: 500 } })
  });
  if (!response.ok) throw new Error(`Firestore ${collection} register lookup failed (HTTP ${response.status}).`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`Firestore ${collection} register returned an invalid response.`);
  return rows.filter(row => row.document?.fields).map(row => {
    const decode = field => {
      if (!field) return null;
      if ("stringValue" in field) return field.stringValue;
      if ("booleanValue" in field) return field.booleanValue;
      if ("integerValue" in field) return Number(field.integerValue);
      if ("timestampValue" in field) return field.timestampValue;
      if ("arrayValue" in field) return (field.arrayValue.values || []).map(decode);
      if ("mapValue" in field) return Object.fromEntries(Object.entries(field.mapValue.fields || {}).map(([key, value]) => [key, decode(value)]));
      return null;
    };
    return { id: row.document.name.split("/").pop(), ...Object.fromEntries(Object.entries(row.document.fields).map(([key, value]) => [key, decode(value)])) };
  });
}

export async function resolveMeetingAuthority(ctx, caller = {}) {
  const now = Number.isFinite(caller.now) ? caller.now : Date.now();
  try {
    const env = caller.env || ctx.env || {};
    const token = typeof ctx.getFirestoreAdminAccessToken === "function"
      ? await ctx.getFirestoreAdminAccessToken(env) : caller.firestoreToken;
    if (!token && typeof ctx.getMeetingAuthorityRegisters !== "function" && typeof ctx.listCollection !== "function") {
      return { allowed: false, authorities: [], reason: "Meeting authority denied: Firestore register credentials are unavailable." };
    }
    const [members, employees, departments] = await Promise.all([
      readCollection(ctx, env, token, "members"),
      readCollection(ctx, env, token, "employees"),
      readCollection(ctx, env, token, "institutionalDepartments")
    ]);
    if (!Array.isArray(members) || !Array.isArray(employees) || !Array.isArray(departments)) {
      return { allowed: false, authorities: [], reason: "Meeting authority denied: one or more authority registers are unavailable." };
    }
    const keys = Object.fromEntries(keyNames.map(key => [key, new Set(callerIdentifiers(caller)[key])]));
    const matched = new Set();
    const records = [...members.map(record => ({ record, source: "Members" })), ...employees.map(record => ({ record, source: "Employees" }))];
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of records) {
        if (matched.has(item.record) || !isActive(item.record, now)) continue;
        const identifiers = recordIdentifiers(item.record);
        if (!intersects(identifiers, keys)) continue;
        matched.add(item.record);
        changed = addKeys(identifiers, keys) || changed;
      }
    }
    const authorities = [];
    for (const { record, source } of records) {
      if (!matched.has(record)) continue;
      for (const role of rolesOf(record)) {
        if (isGrantRole(role)) authorities.push({
          role: normalizeMeetingRole(role), source,
          recordId: clean(record.id) || null,
          department: clean(record.department || record.departmentName) || null
        });
      }
    }
    for (const department of departments) {
      if (!isActive(department, now) || !departmentHeadMatches(department, keys)) continue;
      authorities.push({
        role: MEETING_AUTHORITY_ROLES.DEPARTMENT_HEAD,
        source: "Department Head Register",
        recordId: clean(department.id) || null,
        department: clean(department.name || department.departmentName || department.department) || null
      });
    }
    const unique = [...new Map(authorities.map(item => [`${item.role}|${item.source}|${item.recordId}`, item])).values()];
    return {
      allowed: unique.length > 0,
      authorities: unique,
      reason: unique.length ? "Active Meeting authority confirmed from the institutional registers." :
        matched.size ? "The caller has an active register entry, but no qualifying Meeting authority." :
          "No active Members or Employees register entry matches the caller's identity."
    };
  } catch (error) {
    return {
      allowed: false, authorities: [],
      reason: `Meeting authority denied: register lookup failed; access is closed until the Members, Employees and Department Head registers can be verified. ${clean(error?.message || error)}`
    };
  }
}

export function denialMessage(duty, authorities = []) {
  const read = authorities.length
    ? authorities.map(item => `${item.role} [${item.source}]${item.department ? ` — ${item.department}` : ""}`).join("; ")
    : "No qualifying active authority was found in the registers";
  return `Meeting access denied. Duty attempted: ${clean(duty) || "unspecified Meeting duty"}. Authority read from registers: ${read}. Who may do it: Director of Internal Oversight, Executive Director, or any active Head of Department.`;
}
