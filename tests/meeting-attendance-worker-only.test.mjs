import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const screens = [
  "src/pages/MeetingRoom.jsx",
  "src/pages/Meetings.jsx",
  "src/pages/MeetingEntryGateway.jsx"
];
const clients = [
  "src/firebase/meetingRecords.js",
  "src/firebase/meetingAttendanceSigning.js",
  "src/firebase/meetingGatewayApi.js",
  "src/firebase/signaturePlatform.js"
];

test("attendance screens and their client modules never invoke Firebase callable APIs", () => {
  for (const path of [...screens, ...clients]) {
    const source = read(path);
    assert.equal(source.includes("httpsCallable"), false, path + " must not invoke Firebase callables");
    assert.equal(source.includes("getFunctions("), false, path + " must not initialize callable Functions");
    assert.equal(source.includes("firebase-functions/"), false, path + " must not import server Functions");
  }
});

test("self and host attendance actions use the authenticated Worker attendance route", () => {
  const client = read("src/firebase/meetingRecords.js");
  const room = read("src/pages/MeetingRoom.jsx");
  const gateway = read("src/firebase/meetingGatewayApi.js");
  const worker = read("drive-gateway/src/meetingServices.mjs");
  assert.ok(client.includes('markMeetingAttendance(payload){return callMeetingService("/api/meeting-attendance/mark",payload);}'));
  assert.ok(room.includes("markMeetingAttendance("));
  assert.ok(gateway.includes('callMeetingService(path, payload = {})'));
  assert.ok(worker.includes('"/api/meeting-attendance/mark"'));
  assert.ok(worker.includes('if(pathname==="/api/meeting-attendance/mark")'));
});

test("daily sheet retrieval and marking and quorum assessment use registered Worker routes", () => {
  const client = read("src/firebase/meetingRecords.js");
  const room = read("src/pages/MeetingRoom.jsx");
  const gateway = read("src/firebase/meetingGatewayApi.js");
  const worker = read("drive-gateway/src/meetingServices.mjs");
  assert.ok(client.includes('getDailyMeetingAttendance(meetingId,date){return callMeetingService("/api/meeting-attendance/daily/register",{meetingId,date});}'));
  assert.ok(client.includes('markDailyMeetingAttendance(payload){return callMeetingService("/api/meeting-attendance/daily/mark",payload);}'));
  assert.ok(gateway.includes('callMeetingService("/api/meeting-quorum/assess", payload)'));
  for (const route of [
    "/api/meeting-attendance/daily/register",
    "/api/meeting-attendance/daily/mark",
    "/api/meeting-attendance/daily/dispatch",
    "/api/meeting-quorum/assess"
  ]) assert.ok(worker.includes('"' + route + '"'), "Worker must register " + route);
  for (const handler of [
    'if(pathname==="/api/meeting-attendance/daily/register")',
    'if(pathname==="/api/meeting-attendance/daily/mark")',
    'if(pathname==="/api/meeting-attendance/daily/dispatch")',
    'if(pathname==="/api/meeting-quorum/assess")'
  ]) assert.ok(worker.includes(handler), "Worker must implement " + handler);
  for (const action of ["getDailyMeetingAttendance", "markDailyMeetingAttendance", "assessMeetingQuorum"]) {
    assert.ok(room.includes(action), "Meeting Room must use " + action);
  }
});

test("attendance signing uses the existing Signature Portal API and not callable Functions", () => {
  const signing = read("src/firebase/meetingAttendanceSigning.js");
  const platform = read("src/firebase/signaturePlatform.js");
  assert.ok(signing.includes("createSignatureEnvelope"));
  assert.ok(signing.includes("startSignatureWorkflow"));
  assert.ok(signing.includes('callMeetingService("/api/meeting-attendance/daily/dispatch"'));
  assert.ok(platform.includes("/api/signature-workflow/mutate"));
  assert.ok(platform.includes("/api/signature-invitations/send"));
  assert.equal((signing + platform).includes("httpsCallable"), false);
  assert.equal((signing + platform).includes("getFunctions("), false);
});
