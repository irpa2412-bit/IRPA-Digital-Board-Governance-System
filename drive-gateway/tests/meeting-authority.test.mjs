import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMeetingAuthorityRole, resolveMeetingAuthority, requiredBoardQuorum,
  canVoteInMeeting, MEETING_FULL_ACCESS_DUTIES, MEETING_FULL_ACCESS_EXCLUSIONS
} from "../src/meetingAuthority.mjs";

const now = new Date("2026-11-22T12:00:00.000Z");
const actor = { uid: "uid-1", email: " Person@IRPA.OR.TZ ", memberNumber: " irpa-mem-0007 ", employeeNumber: " irpa-emp-0012 " };
const active = { status: "Active" };

test("Internal Oversight title variants normalize to one permanent authority", () => {
  for (const role of ["Director of Internal Oversight", "Internal Oversight Director", "Director Internal Oversight", "Director of International Oversight"]) {
    assert.equal(normalizeMeetingAuthorityRole(role), "director internal oversight");
    const result = resolveMeetingAuthority({ actor, members: [{ ...active, uid: actor.uid, role }], duty: "approve meeting proceedings", now });
    assert.equal(result.allowed, true, role);
    assert.equal(result.permanent, true);
    assert.equal(result.accessScope, "FULL_MEETING_EXCEPT_DELETION");
  }
});

test("Executive Director receives permanent full Meeting access from the active register", () => {
  const result = resolveMeetingAuthority({ actor, employees: [{ ...active, uid: actor.uid, role: "Executive Director" }], duty: "manage agenda", now });
  assert.equal(result.allowed, true);
  assert.equal(result.authorities[0].role, "Executive Director");
  assert.equal(result.permanent, true);
});

test("UID, normalized email, member number and employee number independently resolve registered authority", () => {
  const cases = [
    { actor: { uid: "uid-1" }, record: { uid: "uid-1" }, key: "uid" },
    { actor: { email: " PERSON@IRPA.OR.TZ " }, record: { email: "person@irpa.or.tz" }, key: "email" },
    { actor: { memberNumber: " irpa-mem-0007 " }, record: { memberNumber: "IRPA-MEM-0007" }, key: "memberNumber" },
    { actor: { employeeNumber: " irpa-emp-0012 " }, record: { employeeNumber: "IRPA-EMP-0012" }, key: "employeeNumber" }
  ];
  for (const item of cases) {
    const result = resolveMeetingAuthority({ actor: item.actor, employees: [{ ...active, ...item.record, role: "Executive Director" }], duty: "open Meeting Portal", now });
    assert.equal(result.allowed, true, item.key);
    assert.equal(result.authorities[0].matchedBy, item.key);
  }
});

test("member-only and employee-only authority records both work", () => {
  assert.equal(resolveMeetingAuthority({ actor: { uid: "m-1" }, members: [{ ...active, uid: "m-1", role: "Executive Director" }], now }).allowed, true);
  assert.equal(resolveMeetingAuthority({ actor: { uid: "e-1" }, employees: [{ ...active, uid: "e-1", role: "Executive Director" }], now }).allowed, true);
});

test("every active HOD receives permanent full Meeting access from a registered HOD record", () => {
  const byPosition = resolveMeetingAuthority({ actor, employees: [{ ...active, uid: actor.uid, position: "Head of Department — Livestock" }], now });
  const byFlag = resolveMeetingAuthority({ actor, members: [{ ...active, uid: actor.uid, isHeadOfDepartment: true, department: "Finance" }], now });
  const byDepartmentRecord = resolveMeetingAuthority({ actor, departments: [{ ...active, id: "dept-1", name: "Research", headUid: actor.uid }] , now });
  for (const result of [byPosition, byFlag, byDepartmentRecord]) {
    assert.equal(result.allowed, true);
    assert.equal(result.authorities[0].role, "Head of Department");
    assert.equal(result.permanent, true);
  }
});

test("inactive, revoked and expired matched authority records deny on the next request", () => {
  const records = [
    { ...active, uid: actor.uid, role: "Executive Director", status: "Inactive" },
    { ...active, uid: actor.uid, role: "Executive Director", revoked: true },
    { ...active, uid: actor.uid, role: "Executive Director", expiresAt: "2026-11-22T11:59:59.000Z" }
  ];
  for (const record of records) {
    const result = resolveMeetingAuthority({ actor, members: [record], now });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /Duty attempted: Meeting Portal access/);
    assert.match(result.reason, /Members, Employees, Department\/HOD registers/);
  }
});

test("active time-limited Meeting access grants work; revoked or expired grants do not", () => {
  const grant = { uid: actor.uid, status: "Active", scope: "MEETING_PORTAL", expiresAt: "2026-11-23T00:00:00.000Z" };
  assert.equal(resolveMeetingAuthority({ actor, accessRecords: [grant], now }).allowed, true);
  assert.equal(resolveMeetingAuthority({ actor, accessRecords: [{ ...grant, status: "Revoked" }], now }).allowed, false);
  assert.equal(resolveMeetingAuthority({ actor, accessRecords: [{ ...grant, expiresAt: "2026-11-22T11:00:00.000Z" }], now }).allowed, false);
});

test("ordinary members, guests and outsiders remain denied unless existing PR #863 policy allows them", () => {
  const ordinary = resolveMeetingAuthority({ actor, members: [{ ...active, uid: actor.uid, role: "Ordinary Member" }], duty: "start Board meeting", now });
  const guest = resolveMeetingAuthority({ actor: { uid: "guest-1" }, members: [], employees: [], now });
  const outsider = resolveMeetingAuthority({ actor: { uid: "outside-1", email: "outside@example.org" }, now });
  assert.equal(ordinary.allowed, false);
  assert.equal(guest.allowed, false);
  assert.equal(outsider.allowed, false);
  const legacy = resolveMeetingAuthority({ actor, members: [{ ...active, uid: actor.uid, role: "Ordinary Member" }], existingPolicy: () => ({ allowed: true, authorities: [{ role: "Board Secretary", sourceCollection: "existingMeetingPolicy" }] }), now });
  assert.equal(legacy.allowed, true);
  assert.equal(legacy.accessScope, "EXISTING_MEETING_POLICY");
});

test("denial states the attempted duty, register authority and permitted roles", () => {
  const result = resolveMeetingAuthority({ actor: { uid: "unknown" }, duty: "delete meeting record", now });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /delete meeting record/);
  assert.match(result.reason, /active IRPA Members, Employees, Department\/HOD registers/);
  assert.match(result.reason, /Executive Director/);
  assert.match(result.reason, /Head of Department/);
});

test("full Meeting duties exclude deletion", () => {
  assert.ok(MEETING_FULL_ACCESS_DUTIES.includes("agenda.manage"));
  assert.ok(MEETING_FULL_ACCESS_DUTIES.includes("proceedings.manage"));
  assert.ok(MEETING_FULL_ACCESS_DUTIES.includes("voting.manage"));
  assert.ok(MEETING_FULL_ACCESS_EXCLUSIONS.includes("meeting.delete"));
  assert.equal(MEETING_FULL_ACCESS_DUTIES.some(value => value.includes("delete")), false);
});

test("Board quorum preserves ceiling of one-third and non-Board meetings have no Board quorum", () => {
  for (const [count, required] of [[1,1],[2,1],[3,1],[4,2],[5,2],[6,2],[7,3],[8,3],[9,3]]) {
    assert.equal(requiredBoardQuorum(count), required, "active Board Members: " + count);
  }
  assert.equal(requiredBoardQuorum(0), null);
  assert.equal(requiredBoardQuorum(8, { meetingType: "Staff Meeting" }), 0);
});

test("voting remains limited to active registered Board Members in Governance meetings", () => {
  const governance = { meetingCategory: "GOVERNANCE" };
  assert.equal(canVoteInMeeting(governance, { active: true, isBoardMember: true, role: "Board Member" }), true);
  assert.equal(canVoteInMeeting(governance, { active: true, isBoardMember: true, role: "Board Chairperson" }), true);
  assert.equal(canVoteInMeeting(governance, { active: true, isBoardMember: false, role: "Board Member" }), false);
  assert.equal(canVoteInMeeting(governance, { active: false, isBoardMember: true, role: "Board Member" }), false);
  assert.equal(canVoteInMeeting({ meetingCategory: "STAFF" }, { active: true, isBoardMember: true, role: "Board Member" }), false);
});
