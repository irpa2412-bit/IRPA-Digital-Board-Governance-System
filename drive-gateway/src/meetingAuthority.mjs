const clean = value => String(value ?? "").trim();
const lower = value => clean(value).toLowerCase();
const ACTIVE = new Set(["active", "activated", "approved", "current"]);
const DENIED = new Set(["inactive", "revoked", "expired", "terminated", "disabled", "suspended", "removed", "cancelled", "canceled", "deactivated", "lapsed", "withdrawn"]);
const ROLE_FIELDS = ["role", "title", "position", "jobTitle", "designation", "departmentalRole", "authorityRole", "boardPosition", "departmentRole", "post"];
const ARRAY_ROLE_FIELDS = ["roles", "assignedRoles", "selectedRoles", "roleAssignments", "authorities"];
const STATUS_FIELDS = ["status", "employmentStatus", "membershipStatus", "authorityStatus", "accessStatus", "registrationStatus", "revocationStatus"];
const EXPIRY_FIELDS = ["authorityExpiresAt", "authorityExpiry", "authorityValidUntil", "validUntil", "expiresAt", "expiryDate", "endDate", "validThrough"];
export const MEETING_FULL_ACCESS_DUTIES = Object.freeze([
  "meeting.read", "meeting.create", "meeting.edit", "meeting.schedule", "meeting.reschedule", "meeting.cancel",
  "agenda.manage", "invitation.manage", "guest.manage", "attendance.manage", "room.manage",
  "minutes.manage", "proceedings.manage", "documents.manage", "voting.manage", "resolutions.manage",
  "decisions.manage", "actions.manage", "records.read", "records.update"
]);
export const MEETING_FULL_ACCESS_EXCLUSIONS = Object.freeze(["meeting.delete", "meeting.record.delete", "proceedings.delete"]);
export const MEETING_PERMANENT_AUTHORITY_ROLES = Object.freeze([
  "Director of Internal Oversight (including registered Internal Oversight Director and legacy Director of International Oversight titles)",
  "Executive Director",
  "Registered Head of Department"
]);

const normalizeWords = value => lower(value)
  .replace(/&/g, " and ")
  .replace(/[._,;:/\\()[\]{}–—-]+/g, " ")
  .replace(/\bof\b/g, " ")
  .replace(/\bthe\b/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export function normalizeMeetingAuthorityRole(value) {
  const normalized = normalizeWords(value);
  if ([
    "director internal oversight", "internal oversight director",
    "director international oversight", "international oversight director"
  ].includes(normalized)) return "director internal oversight";
  if (normalized === "executive director") return "executive director";
  return normalized;
}

function roleValues(record = {}) {
  const values = ROLE_FIELDS.map(key => record?.[key]);
  for (const key of ARRAY_ROLE_FIELDS) {
    const items = Array.isArray(record?.[key]) ? record[key] : [];
    for (const item of items) {
      if (typeof item === "string") values.push(item);
      else if (item && typeof item === "object") values.push(item.role, item.title, item.authorityRole, item.name);
    }
  }
  return values.map(clean).filter(Boolean);
}

function hasHodAuthority(record = {}) {
  const flags = ["isHeadOfDepartment", "isDepartmentHead", "headOfDepartment", "departmentHead", "isHod", "hod"];
  if (flags.some(key => record?.[key] === true)) return true;
  return roleValues(record).some(value => {
    const role = normalizeWords(value);
    return role === "hod" || role.includes("head of department") || role.includes("department head");
  });
}
function isDepartmentHeadAssignment(actor, record = {}) {
  const nested = record.departmentHead && typeof record.departmentHead === "object" ? record.departmentHead
    : record.headOfDepartment && typeof record.headOfDepartment === "object" ? record.headOfDepartment
      : record.hod && typeof record.hod === "object" ? record.hod : {};
  const reference = {
    uid: record.headUid || record.departmentHeadUid || record.hodUid || record.headOfDepartmentUid || record.departmentHeadUserId || nested.uid || nested.userId,
    email: record.headEmail || record.departmentHeadEmail || record.hodEmail || record.headOfDepartmentEmail || nested.email,
    memberNumber: record.headMemberNumber || record.departmentHeadMemberNumber || record.hodMemberNumber || nested.memberNumber,
    employeeNumber: record.headEmployeeNumber || record.departmentHeadEmployeeNumber || record.hodEmployeeNumber || nested.employeeNumber
  };
  return Boolean(matchRecord(actor, reference, "register"));
}

const normalizeKey = (value, type) => {
  const raw = clean(value);
  if (!raw) return "";
  if (type === "email") return raw.toLowerCase();
  if (type === "number") return raw.toUpperCase().replace(/\s+/g, "");
  return raw;
};

function actorKeys(actor = {}) {
  return {
    uid: new Set([actor.uid, actor.authUid, actor.userUid, actor.userId, actor.sub].map(v => normalizeKey(v, "uid")).filter(Boolean)),
    email: new Set([actor.email, actor.emailAddress, actor.firebaseAuthEmail].map(v => normalizeKey(v, "email")).filter(Boolean)),
    memberNumber: new Set([actor.memberNumber, actor.registrationNumber].map(v => normalizeKey(v, "number")).filter(Boolean)),
    employeeNumber: new Set([actor.employeeNumber, actor.staffNumber, actor.personnelNumber].map(v => normalizeKey(v, "number")).filter(Boolean))
  };
}

function recordKeys(record = {}, source = "register") {
  const keys = {
    uid: [record.uid, record.authUid, record.userUid, record.userId, record.firebaseUid, record.id],
    email: [record.email, record.emailAddress, record.contactEmail, record.firebaseAuthEmail, record.memberEmail, record.employeeEmail],
    memberNumber: [record.memberNumber, record.registrationNumber],
    employeeNumber: [record.employeeNumber, record.staffNumber, record.personnelNumber]
  };
  if (source === "departments" || source === "departmentHeads") {
    keys.uid.push(record.headUid, record.departmentHeadUid, record.hodUid, record.headOfDepartmentUid, record.departmentHeadUserId);
    keys.email.push(record.headEmail, record.departmentHeadEmail, record.hodEmail, record.headOfDepartmentEmail);
    keys.memberNumber.push(record.headMemberNumber, record.departmentHeadMemberNumber, record.hodMemberNumber);
    keys.employeeNumber.push(record.headEmployeeNumber, record.departmentHeadEmployeeNumber, record.hodEmployeeNumber);
  }
  return Object.fromEntries(Object.entries(keys).map(([type, values]) => [
    type, new Set(values.map(v => normalizeKey(v, type === "email" ? "email" : type.includes("Number") ? "number" : "uid")).filter(Boolean))
  ]));
}

function matchRecord(actor, record, source) {
  const left = actorKeys(actor);
  const right = recordKeys(record, source);
  for (const type of ["uid", "email", "memberNumber", "employeeNumber"]) {
    for (const value of left[type]) if (right[type].has(value)) return type;
  }
  return null;
}

function expiryValue(record) {
  for (const key of EXPIRY_FIELDS) if (record?.[key] !== undefined && record?.[key] !== null && clean(record[key])) return record[key];
  return null;
}

function timestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return Date.parse(String(value));
}

export function meetingAuthorityRecordStatus(record = {}, now = new Date()) {
  if (record.revoked === true || record.isRevoked === true || record.active === false || record.isActive === false ||
      clean(record.revokedAt) || clean(record.revocationAt)) {
    return { active: false, reason: "Authority record is inactive or revoked." };
  }
  for (const key of STATUS_FIELDS) {
    const value = normalizeWords(record?.[key]);
    if (!value) continue;
    const exact = value.replace(/\s+/g, " ");
    if (DENIED.has(exact) || /(^| )(inactive|revoked|expired|terminated|disabled|suspended|removed|cancelled|canceled|deactivated|lapsed|withdrawn|pending)( |$)/.test(exact)) {
      return { active: false, reason: "Authority record status is " + clean(record[key]) + "." };
    }
  }
  const expiry = expiryValue(record);
  if (expiry !== null) {
    const expires = timestamp(expiry);
    if (!Number.isFinite(expires)) return { active: false, reason: "Authority record has an invalid expiry date." };
    if (expires <= timestamp(now)) return { active: false, reason: "Authority record has expired." };
  }
  const statusActive = STATUS_FIELDS.some(key => ACTIVE.has(normalizeWords(record?.[key])));
  if (record.active !== true && record.isActive !== true && !statusActive) {
    return { active: false, reason: "Authority record is not explicitly active in the register." };
  }
  return { active: true, reason: "Authority record is active and unexpired." };
}

function isInternalOversight(record) {
  return roleValues(record).some(value => normalizeMeetingAuthorityRole(value) === "director internal oversight");
}
function isExecutiveDirector(record) {
  return roleValues(record).some(value => normalizeMeetingAuthorityRole(value) === "executive director");
}
function isMeetingGrant(record) {
  if (record.fullMeetingAccess === true || record.meetingPortalFullAccess === true || record.meetingFullAccess === true) return true;
  const scopes = [record.scope, record.resource, record.accessScope, record.permission, record.authorityType]
    .flatMap(value => Array.isArray(value) ? value : [value]).map(normalizeWords);
  if (scopes.some(value => ["meeting", "meeting portal", "full meeting", "meeting portal full access", "meeting full access"].includes(value))) return true;
  return roleValues(record).some(value => normalizeWords(value) === "meeting portal full access");
}

export function denyMeetingAuthority(duty, reason, authorities = [], permittedRoles = MEETING_PERMANENT_AUTHORITY_ROLES) {
  const attempted = clean(duty) || "Meeting Portal access";
  const permitted = [...new Set([...permittedRoles, "Actors authorised under the existing PR #863 Meeting policy"])];
  return {
    allowed: false,
    authorities: Array.isArray(authorities) ? authorities : [],
    reason: "Duty attempted: " + attempted + ". " + clean(reason) +
      " Authority is read from the active IRPA Members, Employees, Department/HOD registers and current Meeting access records. Permitted roles: " + permitted.join("; ") + ".",
    duty: attempted,
    permittedRoles: permitted,
    accessScope: "MEETING_PORTAL",
    permanent: false
  };
}

function existingPolicyDecision(existingPolicy, actor, meeting, duty) {
  if (typeof existingPolicy === "function") return existingPolicy({ actor, meeting, duty });
  return existingPolicy;
}

export function resolveMeetingAuthority({
  actor = {}, members = [], employees = [], departments = [], departmentHeads = [],
  accessRecords = [], meeting = {}, duty = "Meeting Portal access", existingPolicy = null, now = new Date()
} = {}) {
  const attempted = clean(duty) || "Meeting Portal access";
  const sources = [
    ["members", Array.isArray(members) ? members : []],
    ["employees", Array.isArray(employees) ? employees : []],
    ["departments", Array.isArray(departments) ? departments : []],
    ["departmentHeads", Array.isArray(departmentHeads) ? departmentHeads : []]
  ];
  const matches = [];
  for (const [source, records] of sources) {
    for (const record of records) {
      const matchedBy = matchRecord(actor, record, source);
      if (matchedBy) matches.push({ source, record, matchedBy });
    }
  }
  const authorities = [];
  const inactive = matches.map(match => ({ ...match, state: meetingAuthorityRecordStatus(match.record, now) }))
    .filter(match => !match.state.active);
  for (const match of matches) {
    const state = meetingAuthorityRecordStatus(match.record, now);
    const roles = roleValues(match.record);
    authorities.push({
      role: roles[0] || (match.source === "departments" || match.source === "departmentHeads" ? "Department/HOD register entry" : "Registered " + match.source.slice(0, -1)),
      roles,
      sourceCollection: match.source,
      sourceRecordId: clean(match.record.id || match.record.recordId) || null,
      matchedBy: match.matchedBy,
      status: state.active ? "ACTIVE" : "DENIED",
      statusReason: state.reason
    });
  }
  if (inactive.length) {
    const first = inactive[0];
    return denyMeetingAuthority(attempted, first.state.reason + " Access is denied on this request.", authorities);
  }

  const grants = [];
  for (const match of matches) {
    const record = match.record;
    const state = meetingAuthorityRecordStatus(record, now);
    if (!state.active) continue;
    let grantedRole = null;
    if (isInternalOversight(record)) grantedRole = "Director of Internal Oversight";
    else if (isExecutiveDirector(record)) grantedRole = "Executive Director";
    else if (hasHodAuthority(record) || ((match.source === "departments" || match.source === "departmentHeads") && isDepartmentHeadAssignment(actor, record))) grantedRole = "Head of Department";
    if (grantedRole) grants.push({
      role: grantedRole,
      sourceCollection: match.source,
      sourceRecordId: clean(record.id || record.recordId) || null,
      matchedBy: match.matchedBy,
      permanent: true,
      scope: "FULL_MEETING_EXCEPT_DELETION"
    });
  }

  const activeAccessGrants = [];
  const inactiveAccessGrants = [];
  for (const record of Array.isArray(accessRecords) ? accessRecords : []) {
    const matchedBy = matchRecord(actor, record, "accessRecords");
    if (!matchedBy || !isMeetingGrant(record)) continue;
    const state = meetingAuthorityRecordStatus(record, now);
    if (!state.active) {
      inactiveAccessGrants.push({ record, matchedBy, state });
      continue;
    }
    activeAccessGrants.push({
      role: clean(record.role || record.authorityRole || "Meeting Portal access grant"),
      sourceCollection: "meetingAuthorityAccess",
      sourceRecordId: clean(record.id || record.recordId) || null,
      matchedBy,
      permanent: false,
      expiresAt: expiryValue(record) || null,
      scope: "FULL_MEETING_EXCEPT_DELETION"
    });
  }

  if (grants.length || activeAccessGrants.length) {
    const granted = [...grants, ...activeAccessGrants];
    return {
      allowed: true,
      authorities: granted,
      reason: "Duty attempted: " + attempted + ". Access is authorised by active registered Meeting authority. Authority was verified against the current IRPA registers and access records.",
      duty: attempted,
      permittedRoles: MEETING_PERMANENT_AUTHORITY_ROLES,
      accessScope: "FULL_MEETING_EXCEPT_DELETION",
      permissions: MEETING_FULL_ACCESS_DUTIES,
      excludedDuties: MEETING_FULL_ACCESS_EXCLUSIONS,
      permanent: grants.length > 0
    };
  }

  let legacy;
  try {
    legacy = existingPolicyDecision(existingPolicy, actor, meeting, attempted);
  } catch {
    return denyMeetingAuthority(attempted, "The existing Meeting policy lookup failed; access is denied by default.", authorities);
  }
  if (legacy === true || legacy?.allowed === true) {
    const legacyAuthorities = Array.isArray(legacy?.authorities) ? legacy.authorities : [{
      role: "Existing PR #863 Meeting policy",
      sourceCollection: "existingMeetingPolicy",
      matchedBy: "policy",
      permanent: false
    }];
    return {
      allowed: true,
      authorities: [...authorities, ...legacyAuthorities],
      reason: "Duty attempted: " + attempted + ". Access is authorised by the existing PR #863 Meeting policy after current register checks.",
      duty: attempted,
      permittedRoles: Array.isArray(legacy?.permittedRoles) ? legacy.permittedRoles : ["Existing PR #863 Meeting policy roles"],
      accessScope: "EXISTING_MEETING_POLICY",
      permanent: false
    };
  }

  const noRecordReason = matches.length
    ? "The matched active register records do not confer this Meeting duty."
    : "No matching active Member, Employee or Department/HOD authority record was found.";
  const grantNote = inactiveAccessGrants.length ? " A matching Meeting access record is revoked, inactive or expired." : "";
  return denyMeetingAuthority(attempted, noRecordReason + grantNote + " Access is denied by default.", authorities);
}

export function isBoardMeeting(meeting = {}) {
  return [meeting.meetingType, meeting.meetingTitle, meeting.title, meeting.category]
    .some(value => ["board", "board meeting"].includes(lower(value)));
}

export function requiredBoardQuorum(activeBoardMemberCount, meeting = { meetingType: "Board Meeting" }) {
  if (!isBoardMeeting(meeting)) return 0;
  const count = Number(activeBoardMemberCount);
  if (!Number.isInteger(count) || count <= 0) return null;
  return Math.ceil(count / 3);
}

function governanceMeeting(meeting = {}) {
  const value = lower(meeting.meetingCategory || meeting.meetingPolicyId || meeting.category || meeting.meetingType);
  return [
    "governance", "governance meetings", "board", "board meeting", "board committee meeting",
    "annual general meeting", "special meeting"
  ].includes(value);
}

export function canVoteInMeeting(meeting = {}, identity = {}) {
  if (!governanceMeeting(meeting) || identity.active !== true) return false;
  const roles = new Set([
    identity.role, identity.title, identity.position, identity.departmentalRole,
    ...(Array.isArray(identity.roles) ? identity.roles : []),
    ...(Array.isArray(identity.assignedRoles) ? identity.assignedRoles : []),
    ...(Array.isArray(identity.selectedRoles) ? identity.selectedRoles : [])
  ].map(normalizeMeetingAuthorityRole).filter(Boolean));
  return (roles.has("board member") || roles.has("board chairperson")) && identity.isBoardMember === true;
}
