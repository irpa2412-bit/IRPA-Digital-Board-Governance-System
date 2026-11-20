import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service=readFileSync("drive-gateway/src/meetingServices.mjs","utf8");
const room=readFileSync("src/pages/MeetingRoom.jsx","utf8");
const records=readFileSync("src/firebase/meetingRecords.js","utf8");
const signaturePlatform=readFileSync("src/firebase/signaturePlatform.js","utf8");
const signatureWorker=readFileSync("drive-gateway/src/signing.mjs","utf8");
const signaturePage=readFileSync("src/pages/SignaturePlatform.jsx","utf8");

test("Meeting Portal retains daily categorical attendance, date selection and exports",()=>{
 assert.ok(room.includes("getDailyMeetingAttendance"));
 assert.ok(room.includes("dailyAttendanceDate"));
 assert.ok(room.includes("N/A — Not Attended"));
 assert.ok(room.includes("BOARD_MEMBERS"));
 assert.ok(room.includes("EMPLOYEES_AND_MANAGEMENT"));
 assert.ok(service.includes('attendanceStatus:"N/A"'));
 assert.ok(service.includes('registrationCategory:"BOARD_MEMBER"'));
 assert.ok(service.includes("UNMATCHED_BOARD_REGISTRATION"));
 assert.ok(room.includes("Download Consolidated CSV"));
 assert.ok(room.includes("Print Daily Sheet"));
});

test("daily attendance records remain independently readable and markable",()=>{
 assert.ok(service.includes("/api/meeting-attendance/daily/register"));
 assert.ok(service.includes("/api/meeting-attendance/daily/mark"));
 assert.ok(records.includes("getDailyMeetingAttendance"));
 assert.ok(records.includes("markDailyMeetingAttendance"));
 assert.ok(service.includes("meetingDailyAttendance"));
});

test("Meeting Portal no longer invokes or resumes automatic Email-link signing",()=>{
 assert.ok(!room.includes("meetingAttendanceSigning"));
 assert.ok(!room.includes("dispatchDailyAttendanceSigning"));
 assert.ok(!room.includes("resumeDailyAttendanceSigning"));
 assert.ok(!room.includes("Dispatch Signing Requests"));
 assert.ok(room.includes("Automatic attendance-sheet signing is temporarily disconnected"));
 assert.ok(room.includes("Open Signature Portal"));
 assert.ok(room.includes('nav("Signature Platform")'));
});

test("standalone Signature Portal email-link workflow remains present and unchanged in its service contract",()=>{
 assert.ok(signaturePlatform.includes("export async function createSignatureEnvelope"));
 assert.ok(signaturePlatform.includes("export async function startSignatureWorkflow"));
 assert.ok(signaturePage.includes("Signature Platform"));
 assert.ok(signatureWorker.includes("sendSignatureInvitation"));
 assert.ok(signatureWorker.includes("SMTP_CONNECT"));
});

test("legacy attendance dispatch records and signed quorum reconciliation remain available for existing records",()=>{
 assert.ok(service.includes("meetingAttendanceDispatches"));
 assert.ok(service.includes("getGatewayEnvelopeStatus"));
 assert.ok(service.includes("auditChainValid===true"));
 assert.ok(service.includes("dailySignerByUid"));
 assert.ok(service.includes("Math.ceil(denominator/3)"));
 assert.ok(records.includes("/api/meeting-attendance/daily/dispatch"));
 assert.ok(!service.includes("/api/meeting-attendance/sign"));
});
