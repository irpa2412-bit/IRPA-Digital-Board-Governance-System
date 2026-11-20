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
 assert.match(room,/getDailyMeetingAttendance/);
 assert.match(room,/dailyAttendanceDate/);
 assert.match(room,/N\\/A — Not Attended/);
 assert.match(room,/BOARD_MEMBERS/);
 assert.match(room,/EMPLOYEES_AND_MANAGEMENT/);
 assert.match(service,/attendanceStatus:"N\\/A"/);
 assert.match(service,/registrationCategory:"BOARD_MEMBER"/);
 assert.match(service,/UNMATCHED_BOARD_REGISTRATION/);
 assert.match(room,/Download Consolidated CSV/);
 assert.match(room,/Print Daily Sheet/);
});

test("daily attendance records remain independently readable and markable",()=>{
 assert.match(service,/\/api\/meeting-attendance\/daily\/register/);
 assert.match(service,/\/api\/meeting-attendance\/daily\/mark/);
 assert.match(records,/getDailyMeetingAttendance/);
 assert.match(records,/markDailyMeetingAttendance/);
 assert.match(service,/meetingDailyAttendance/);
});

test("Meeting Portal no longer invokes or resumes automatic Email-link signing",()=>{
 assert.doesNotMatch(room,/meetingAttendanceSigning/);
 assert.doesNotMatch(room,/dispatchDailyAttendanceSigning/);
 assert.doesNotMatch(room,/resumeDailyAttendanceSigning/);
 assert.doesNotMatch(room,/Dispatch Signing Requests/);
 assert.match(room,/Automatic attendance-sheet signing is temporarily disconnected/);
 assert.match(room,/Open Signature Portal/);
 assert.match(room,/nav\("Signature Platform"\)/);
});

test("standalone Signature Portal email-link workflow remains present and unchanged in its service contract",()=>{
 assert.match(signaturePlatform,/export async function createSignatureEnvelope/);
 assert.match(signaturePlatform,/export async function startSignatureWorkflow/);
 assert.match(signaturePage,/Signature Platform/);
 assert.match(signatureWorker,/sendSignatureInvitation/);
 assert.match(signatureWorker,/SMTP_CONNECT/);
});

test("legacy attendance dispatch records and signed quorum reconciliation remain available for existing records",()=>{
 assert.match(service,/meetingAttendanceDispatches/);
 assert.match(service,/getGatewayEnvelopeStatus/);
 assert.match(service,/auditChainValid===true/);
 assert.match(service,/dailySignerByUid/);
 assert.match(service,/Math\\.ceil\\(denominator\\/3\\)/);
 assert.match(records,/\/api\/meeting-attendance\/daily\/dispatch/);
 assert.doesNotMatch(service,/\/api\/meeting-attendance\/sign/);
});
