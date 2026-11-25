import test from "node:test";
import assert from "node:assert/strict";
import { MEETING_AUTHORITY_ROLES as workerRoles, normalizeMeetingRole as workerNormalise } from "../src/meetingAuthority.mjs";
import { MEETING_AUTHORITY_ROLES as clientRoles, normalizeMeetingRole as clientNormalise, resolveMeetingAuthorityFromRecords } from "../../src/firebase/meetingAuthority.js";

test("Worker and screen normalisers and canonical role lists are identical", () => {
  const samples = [
    "Director of Internal Oversight", "Internal Oversight Director", "Director of International Oversight",
    "Executive Director", "Head of Department", "Regional HOD", " ordinary member "
  ];
  assert.deepEqual(workerRoles, clientRoles);
  for (const role of samples) assert.equal(workerNormalise(role), clientNormalise(role), role);
});
test("screen pure resolver uses the same authority decision for a department head", () => {
  const result = resolveMeetingAuthorityFromRecords({ uid: "hod-1" }, {
    members: [], employees: [],
    departments: [{ id: "d1", status: "Active", headUid: "hod-1", name: "Finance" }]
  });
  assert.equal(result.allowed, true);
  assert.equal(result.authorities[0].role, clientRoles.DEPARTMENT_HEAD);
});
test("screen pure resolver fails closed for revoked records", () => {
  const result = resolveMeetingAuthorityFromRecords({ uid: "u" }, {
    members: [{ uid: "u", role: "Executive Director", status: "Revoked" }], employees: [], departments: []
  });
  assert.equal(result.allowed, false);
});
