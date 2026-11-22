import test from "node:test";
import assert from "node:assert/strict";
import { denialMessage, MEETING_AUTHORITY_ROLES, normalizeMeetingRole, resolveMeetingAuthority } from "../src/meetingAuthority.mjs";

const active = extra => ({ status: "Active", ...extra });
const registers = (members = [], employees = [], departments = []) => ({ members, employees, departments });
const ctxFor = data => ({ getMeetingAuthorityRegisters: async () => data });

test("resolves authority by UID, including multiple qualifying roles", async () => {
  const result = await resolveMeetingAuthority(ctxFor(registers([active({ uid: "u1", roles: ["Executive Director", "Director of Internal Oversight"] })])), { uid: "u1" });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.authorities.map(item => item.role).sort(), [MEETING_AUTHORITY_ROLES.EXECUTIVE, MEETING_AUTHORITY_ROLES.OVERSIGHT].sort());
});
test("resolves authority by trimmed case-insensitive email", async () => {
  const result = await resolveMeetingAuthority(ctxFor(registers([active({ email: "  LEAD@IRPA.OR.TZ ", position: "Executive Director" })])), { email: " lead@irpa.or.tz " });
  assert.equal(result.allowed, true);
});
test("resolves authority by IRPA member number", async () => {
  const result = await resolveMeetingAuthority(ctxFor(registers([active({ id: "member-1", memberNumber: "IRPA-MEM-004", role: "Director of Internal Oversight" })])), { memberNumber: "IRPA-MEM-004" });
  assert.equal(result.allowed, true);
});
test("resolves authority by IRPA employee number", async () => {
  const result = await resolveMeetingAuthority(ctxFor(registers([], [active({ id: "employee-1", employeeNumber: "IRPA-EMP-009", role: "Executive Director" })])), { employeeNumber: "IRPA-EMP-009" });
  assert.equal(result.allowed, true);
});
test("resolves a department head through the department register", async () => {
  const result = await resolveMeetingAuthority(ctxFor(registers([], [], [active({ id: "dept-1", name: "Finance", headUid: "hod-1" })])), { uid: "hod-1" });
  assert.equal(result.allowed, true);
  assert.equal(result.authorities[0].source, "Department Head Register");
});
test("accepts all three oversight title spellings as one role", async () => {
  for (const role of ["Director of Internal Oversight", "Internal Oversight Director", "Director of International Oversight"]) {
    const result = await resolveMeetingAuthority(ctxFor(registers([active({ uid: role, role })])), { uid: role });
    assert.equal(result.allowed, true, role);
    assert.equal(result.authorities[0].role, MEETING_AUTHORITY_ROLES.OVERSIGHT);
  }
});
test("recognises position text containing Head of Department or HOD and explicit flags", async () => {
  for (const record of [
    { position: "Regional Head of Department - Livestock" },
    { position: "HOD, Rangeland" },
    { isHeadOfDepartment: true, title: "Field Director" }
  ]) {
    const result = await resolveMeetingAuthority(ctxFor(registers([active({ uid: "head", ...record })])), { uid: "head" });
    assert.equal(result.allowed, true);
    assert.equal(result.authorities[0].role, MEETING_AUTHORITY_ROLES.DEPARTMENT_HEAD);
  }
});
test("inactive, revoked and expired register entries deny", async () => {
  for (const record of [
    { status: "Inactive" }, { status: "Revoked" }, { status: "Active", revoked: true },
    { status: "Active", expiresAt: "2020-01-01T00:00:00.000Z" }
  ]) {
    const result = await resolveMeetingAuthority(ctxFor(registers([ { uid: "u", role: "Executive Director", ...record } ])), { uid: "u", now: Date.now() });
    assert.equal(result.allowed, false);
  }
});
test("a member-only record and an employee-only record are each independently recognised", async () => {
  const member = await resolveMeetingAuthority(ctxFor(registers([active({ uid: "m", role: "Executive Director" })], [])), { uid: "m" });
  const employee = await resolveMeetingAuthority(ctxFor(registers([], [active({ uid: "e", role: "Executive Director" })])), { uid: "e" });
  assert.equal(member.allowed, true);
  assert.equal(employee.allowed, true);
});
test("ordinary member, guest and outsider do not receive full Meeting authority", async () => {
  const data = registers([active({ uid: "member", role: "Member" })], [active({ uid: "guest", role: "Guest" })]);
  for (const uid of ["member", "guest", "outsider"]) {
    const result = await resolveMeetingAuthority(ctxFor(data), { uid });
    assert.equal(result.allowed, false, uid);
  }
});
test("lookup failure denies closed with a specific reason", async () => {
  const result = await resolveMeetingAuthority({ getMeetingAuthorityRegisters: async () => { throw new Error("Employees register unavailable"); } }, { uid: "u" });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /register lookup failed/i);
  assert.match(result.reason, /Employees register unavailable/);
});
test("missing register records deny with an explicit reason", async () => {
  const result = await resolveMeetingAuthority(ctxFor(registers()), { uid: "unknown" });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /No active Members or Employees register entry/);
});
test("denial message identifies duty, register evidence and permitted roles", () => {
  const message = denialMessage("approve agenda", [{ role: "Member", source: "Members" }]);
  assert.match(message, /Duty attempted: approve agenda/);
  assert.match(message, /Member \[Members\]/);
  assert.match(message, /Director of Internal Oversight.*Executive Director.*Head of Department/);
});
