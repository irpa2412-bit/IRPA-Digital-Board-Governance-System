import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canAccessMeetingCategory,
  canRegisterMeeting,
  canEditMeeting,
  canVoteInMeeting,
  meetingCapabilities
} from "../src/firebase/meetingPolicy.js";

const governance = {
  id: "meeting-1",
  meetingCategory: "GOVERNANCE",
  meetingPolicyId: "GOVERNANCE",
  status: "Scheduled",
  initiatorUid: "secretary-1"
};

test("governance category denies an unrelated active staff identity", () => {
  assert.equal(canAccessMeetingCategory(governance, {
    uid: "staff-1", active: true, activeEmployee: true, role: "Staff"
  }), false);
});

test("governance category allows authorised board roles and administrators", () => {
  assert.equal(canAccessMeetingCategory(governance, {
    uid: "board-1", active: true, activeMember: true, isBoardMember: true, role: "Board Member"
  }), true);
  assert.equal(canAccessMeetingCategory(governance, { uid: "admin-1", isAdmin: true }), true);
});

test("general meetings allow active institutional members and employees", () => {
  const general = { meetingCategory: "GENERAL", meetingPolicyId: "GENERAL" };
  assert.equal(canAccessMeetingCategory(general, { active: true, activeMember: true }), true);
  assert.equal(canAccessMeetingCategory(general, { active: true, activeEmployee: true }), true);
});

test("explicitly invited participants can access their meeting regardless of institutional role", () => {
  assert.equal(canAccessMeetingCategory(governance, {
    uid: "external-expert", active: true, role: "External Expert"
  }, { isInvited: true }), true);
});

test("meeting registration requires an active designated institutional role", () => {
  assert.equal(canRegisterMeeting({ active: true, role: "Departmental Director" }), true);
  assert.equal(canRegisterMeeting({ active: false, role: "Departmental Director" }), false);
  assert.equal(canRegisterMeeting({ active: true, role: "Staff" }), false);
  assert.equal(canRegisterMeeting({ isAdmin: true }), true);
});

test("released meeting edits are administrator-only", () => {
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Registered" }, {
    uid: "secretary-1", active: true, role: "Board Secretary"
  }), false);
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Registered" }, { isAdmin: true }), true);
});

test("a designated initiator may edit only an unreleased meeting they initiated", () => {
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Draft" }, {
    uid: "secretary-1", active: true, role: "Board Secretary"
  }), true);
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Draft" }, {
    uid: "another-user", active: true, role: "Board Secretary"
  }), false);
});

test("voting is restricted to active registered board members in governance meetings", () => {
  assert.equal(canVoteInMeeting(governance, {
    active: true, activeMember: true, isBoardMember: true, role: "Board Member"
  }), true);
  assert.equal(canVoteInMeeting(governance, {
    active: true, activeMember: true, role: "Staff"
  }), false);
  assert.equal(canVoteInMeeting({ meetingCategory: "STAFF", meetingPolicyId: "STAFF" }, {
    active: true, activeMember: true, isBoardMember: true, role: "Board Member"
  }), false);
});

test("category capabilities keep voting and resolutions disabled outside governance", () => {
  const staff = meetingCapabilities({ meetingCategory: "STAFF", meetingPolicyId: "STAFF" });
  assert.equal(staff.voting, false);
  assert.equal(staff.resolutions, false);
  assert.equal(staff.facilities.signature, false);
  const governanceCapabilities = meetingCapabilities(governance);
  assert.equal(governanceCapabilities.voting, true);
  assert.equal(governanceCapabilities.resolutions, true);
});

const meetingDataSource = readFileSync(new URL("../src/firebase/data.js", import.meta.url), "utf8");
test("meeting register retrieval avoids an unscoped collection read", () => {
  const start = meetingDataSource.indexOf("export async function getAccessibleMeetingRecords");
  const end = meetingDataSource.indexOf("function meetingCreatedAt", start);
  assert.ok(start >= 0 && end > start, "meeting retrieval function must be present");
  const source = meetingDataSource.slice(start, end);
  assert.doesNotMatch(source, /if\s*\(user\.uid\)\s*\{\s*const all\s*=\s*await getDocs\(ref\)/);
  assert.match(source, /for\(const policy of Object\.values\(MEETING_CATEGORIES\)\)/);
  assert.match(source, /query\(ref,where\("initiatorUid","==",uid\)\)/);
  assert.match(source, /for\(const field of \["participantUids"/);
});
