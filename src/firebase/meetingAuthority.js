import {
  resolveMeetingAuthority,
  denyMeetingAuthority,
  MEETING_FULL_ACCESS_DUTIES,
  MEETING_FULL_ACCESS_EXCLUSIONS,
  MEETING_PERMANENT_AUTHORITY_ROLES
} from "../../drive-gateway/src/meetingAuthority.mjs";

export {
  resolveMeetingAuthority,
  denyMeetingAuthority,
  normalizeMeetingAuthorityRole,
  meetingAuthorityRecordStatus,
  requiredBoardQuorum,
  isBoardMeeting,
  canVoteInMeeting,
  MEETING_FULL_ACCESS_DUTIES,
  MEETING_FULL_ACCESS_EXCLUSIONS,
  MEETING_PERMANENT_AUTHORITY_ROLES
} from "../../drive-gateway/src/meetingAuthority.mjs";

export const MEETING_AUTHORITY_COLLECTIONS = Object.freeze({
  members: "members",
  employees: "employees",
  departments: "departments",
  departmentHeads: "departmentHeads",
  accessRecords: "meetingAuthorityAccess"
});

export async function loadMeetingAuthorityRegisters(getRecords, collectionNames = MEETING_AUTHORITY_COLLECTIONS) {
  if (typeof getRecords !== "function") throw new TypeError("A register reader is required.");
  const read = async name => {
    const result = await getRecords(name);
    if (!Array.isArray(result)) throw new Error("The " + name + " authority register did not return a record list.");
    return result;
  };
  const [members, employees, departments, departmentHeads, accessRecords] = await Promise.all([
    read(collectionNames.members),
    read(collectionNames.employees),
    read(collectionNames.departments),
    read(collectionNames.departmentHeads),
    read(collectionNames.accessRecords)
  ]);
  return { members, employees, departments, departmentHeads, accessRecords };
}

export async function checkMeetingAuthority({
  gatewayEnabled = false,
  callWorker = null,
  getRecords = null,
  loadRegisters = null,
  actor = {},
  meeting = {},
  duty = "Meeting Portal access",
  existingPolicy = null,
  now = new Date()
} = {}) {
  const attempted = String(duty || "Meeting Portal access").trim() || "Meeting Portal access";
  if (gatewayEnabled === true) {
    if (typeof callWorker !== "function") {
      return denyMeetingAuthority(attempted, "The Meeting authority Worker is unavailable; access is denied by default.");
    }
    try {
      const response = await callWorker({ meetingId: meeting?.id || null, duty: attempted });
      if (!response || typeof response.allowed !== "boolean") {
        return denyMeetingAuthority(attempted, "The Meeting authority Worker returned an invalid response; access is denied by default.");
      }
      if (response.allowed !== true) {
        return denyMeetingAuthority(attempted, response.reason || "The Meeting authority Worker denied this duty.", response.authorities || []);
      }
      return {
        ...response,
        allowed: true,
        authorities: Array.isArray(response.authorities) ? response.authorities : [],
        duty: attempted
      };
    } catch {
      return denyMeetingAuthority(attempted, "The Meeting authority Worker lookup failed; access is denied by default.");
    }
  }

  try {
    const records = typeof loadRegisters === "function"
      ? await loadRegisters()
      : typeof getRecords === "function"
        ? await loadMeetingAuthorityRegisters(getRecords)
        : null;
    if (!records || typeof records !== "object") {
      return denyMeetingAuthority(attempted, "Direct Member, Employee and Department/HOD register lookup is unavailable; access is denied by default.");
    }
    return resolveMeetingAuthority({ ...records, actor, meeting, duty: attempted, existingPolicy, now });
  } catch {
    return denyMeetingAuthority(attempted, "Direct Member, Employee and Department/HOD register lookup failed; access is denied by default.");
  }
}
