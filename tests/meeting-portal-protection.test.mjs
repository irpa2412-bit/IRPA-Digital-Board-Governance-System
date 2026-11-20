import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const registry = JSON.parse(fs.readFileSync("docs/portal-protection/portal-register.json", "utf8"));
const meeting = registry.portals["Meeting Portal"];

test("Meeting Portal is independently registered against the production rollback baseline", () => {
  assert.equal(meeting.type, "independent portal within the shared IRPA-DBGS application");
  assert.equal(meeting.baselineCommit, "433727282012c75cdaebca21dcdadcb28dba59fb");
  assert.equal(registry.baseline.commit, "433727282012c75cdaebca21dcdadcb28dba59fb");
});

test("Meeting Portal protection covers its UI, Worker, policy, attendance and signature dependencies", () => {
  for (const path of meeting.paths) {
    assert.ok(fs.existsSync(path), `registered Meeting Portal path must exist: ${path}`);
  }
  for (const path of meeting.sharedDependencies) {
    assert.ok(fs.existsSync(path), `registered shared dependency must exist: ${path}`);
  }
  for (const path of [
    "drive-gateway/src/meetingPortal.mjs",
    "drive-gateway/src/meetingServices.mjs",
    "src/firebase/meetingPolicy.js",
    "src/firebase/meetingAttendanceSigning.js",
    "src/pages/Meetings.jsx",
    "src/pages/MeetingRoom.jsx",
    "src/pages/SignaturePlatform.jsx"
  ]) assert.ok(meeting.paths.includes(path), `required protected path missing: ${path}`);
});

test("Meeting Portal data collections and known repair references are protected", () => {
  for (const collection of [
    "meetings", "participants", "meetingAccessTokens", "meetingEntryRequests",
    "meetingAttendanceSignatures", "meetingDailyAttendance", "meetingAttendanceDispatches",
    "meetingSubscriptions", "meetingWorkingDocuments", "meetingDocumentReviews",
    "meetingRoomEvents", "meetingRecords", "meetingMediaRecordings", "votes",
    "resolutions", "decisions", "actions", "members", "employees"
  ]) assert.ok(meeting.collections.includes(collection), `missing protected collection: ${collection}`);
  assert.deepEqual(meeting.knownIssues.issues, [229, 207]);
  assert.deepEqual(meeting.knownIssues.pullRequests, [787]);
});

test("all six previously protected portals remain registered alongside Meeting Portal", () => {
  for (const name of [
    "Invitation Portal",
    "Grants Intelligence and Funding Opportunities Portal",
    "Signature Portal",
    "Board Members Portal",
    "Members and Employees Portal",
    "Communication and Media Portal"
  ]) assert.ok(registry.portals[name], `existing protected portal removed: ${name}`);
  assert.equal(Object.keys(registry.portals).length, 7);
  assert.ok(meeting.tests.includes("tests/meeting-portal-protection.test.mjs"));
});
