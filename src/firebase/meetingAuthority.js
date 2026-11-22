export const MEETING_AUTHORITY_ROLES = Object.freeze({
  OVERSIGHT: "Director of Internal Oversight",
  EXECUTIVE: "Executive Director",
  DEPARTMENT_HEAD: "Head of Department"
});

const clean = value => String(value ?? "").trim();
const normaliseWords = value => clean(value).toLowerCase().replace(/[._-]+/g, " ").replace(/\\s+/g, " ").trim();

export function normalizeMeetingRole(value) {
  const role = normaliseWords(value);
  if (["director of internal oversight", "internal oversight director", "director of international oversight"].includes(role)) {
    return MEETING_AUTHORITY_ROLES.OVERSIGHT;
  }
  if (role === "executive director") return MEETING_AUTHORITY_ROLES.EXECUTIVE;
  if (/head of department|\\bhod\\b/.test(role)) return MEETING_AUTHORITY_ROLES.DEPARTMENT_HEAD;
  return clean(value).replace(/\\s+/g, " ");
}

export function isMeetingAuthorityRole(value) {
  return Object.values(MEETING_AUTHORITY_ROLES).includes(normalizeMeetingRole(value));
}

export function resolveMeetingAuthorityFromRecords(caller = {}, registers = {}, now = Date.now()) {
  const inactive = new Set(["inactive", "disabled", "suspended", "expired", "revoked", "removed", "cancelled", "canceled", "terminated"]);
  const active = record => {
    if (!record || record.active === false || record.revoked === true || record.revokedAt || record.deleted === true) return false;
    const statuses = [record.status, record.employmentStatus, record.registrationStatus, record.authorityStatus].filter(Boolean).map(normaliseWords);
    if (statuses.some(status => inactive.has(status))) return false;
    const expiry = record.expiresAt || record.expiryDate || record.validUntil || record.endDate;
    if (expiry && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) <= now) return false;
    const start = record.effectiveFrom || record.validFrom || record.startDate;
    if (start && Number.isFinite(Date.parse(start)) && Date.parse(start) > now) return false;
    return record.active === true || statuses.some(status => ["active", "activated", "approved", "current", "valid"].includes(status));
  };
  const list = value => Array.isArray(value) ? value : value == null ? [] : [value];
  const identifiers = record => {
    const id = clean(record.id);
    return {
      uid: [record.uid, record.authUid, record.userUid, record.firebaseUid].map(clean).filter(Boolean),
      email: [record.email, record.emailAddress, record.contactEmail, record.officialEmail].map(value => clean(value).toLowerCase()).filter(Boolean),
      memberNumber: [record.memberNumber, record.registrationNumber, record.membershipNumber, /^IRPA-MEM-/i.test(id) ? id : ""].map(clean).filter(Boolean),
      employeeNumber: [record.employeeNumber, record.employeeId, record.staffNumber, /^IRPA-EMP-/i.test(id) ? id : ""].map(clean).filter(Boolean)
    };
  };
  const keys = {
    uid: new Set([caller.uid, caller.user_id, caller.authUid].map(clean).filter(Boolean)),
    email: new Set([caller.email, caller.emailAddress].map(value => clean(value).toLowerCase()).filter(Boolean)),
    memberNumber: new Set(list(caller.memberNumbers ?? caller.memberNumber).map(clean).filter(Boolean)),
    employeeNumber: new Set(list(caller.employeeNumbers ?? caller.employeeNumber).map(clean).filter(Boolean))
  };
  const matches = ids => Object.keys(keys).some(key => ids[key].some(value => keys[key].has(value)));
  const add = ids => Object.keys(keys).forEach(key => ids[key].forEach(value => keys[key].add(value)));
  const rows = [...list(registers.members).map(record => ({ record, source: "Members" })), ...list(registers.employees).map(record => ({ record, source: "Employees" }))];
  const found = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const { record } of rows) {
      if (found.has(record) || !active(record)) continue;
      const ids = identifiers(record);
      if (!matches(ids)) continue;
      found.add(record);
      const before = Object.keys(keys).reduce((sum, key) => sum + keys[key].size, 0);
      add(ids);
      const after = Object.keys(keys).reduce((sum, key) => sum + keys[key].size, 0);
      changed = changed || before !== after;
    }
  }
  const authorities = [];
  const roleValues = record => {
    const candidates = [...list(record.roles), record.role, ...list(record.assignedRoles), ...list(record.positions), record.position, record.jobTitle, record.title, record.designation, record.authority, ...list(record.authorities)];
    if (record.isHeadOfDepartment === true || record.isDepartmentHead === true || record.headOfDepartment === true || record.isHod === true) candidates.push(MEETING_AUTHORITY_ROLES.DEPARTMENT_HEAD);
    return candidates.filter(value => typeof value === "string").flatMap(value => value.split(",")).map(normalizeMeetingRole);
  };
  for (const { record, source } of rows) {
    if (!found.has(record)) continue;
    for (const role of roleValues(record)) if (isMeetingAuthorityRole(role)) authorities.push({ role, source, recordId: clean(record.id) || null, department: clean(record.department || record.departmentName) || null });
  }
  for (const department of list(registers.departments)) {
    if (!active(department)) continue;
    const headIds = {
      uid: [department.headUid, department.headOfDepartmentUid, department.departmentHeadUid, department.managerUid].map(clean).filter(Boolean),
      email: [department.headEmail, department.headOfDepartmentEmail, department.departmentHeadEmail, department.managerEmail].map(value => clean(value).toLowerCase()).filter(Boolean),
      memberNumber: [department.headMemberNumber, department.headOfDepartmentMemberNumber].map(clean).filter(Boolean),
      employeeNumber: [department.headEmployeeNumber, department.headOfDepartmentEmployeeNumber].map(clean).filter(Boolean)
    };
    if (matches(headIds)) authorities.push({ role: MEETING_AUTHORITY_ROLES.DEPARTMENT_HEAD, source: "Department Head Register", recordId: clean(department.id) || null, department: clean(department.name || department.departmentName || department.department) || null });
  }
  const unique = [...new Map(authorities.map(item => [`${item.role}|${item.source}|${item.recordId}`, item])).values()];
  return { allowed: unique.length > 0, authorities: unique };
}
