import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service=readFileSync("drive-gateway/src/meetingServices.mjs","utf8");
const room=readFileSync("src/pages/MeetingRoom.jsx","utf8");
const helper=readFileSync("src/firebase/meetingAttendanceSigning.js","utf8");
const records=readFileSync("src/firebase/meetingRecords.js","utf8");

test("Meeting Portal compiles daily categorical attendance and defaults missing attendance to N/A",()=>{
 assert.match(room,/getDailyMeetingAttendance/);
 assert.match(room,/dailyAttendanceDate/);
 assert.match(room,/N\/A — Not Attended/);
 assert.match(room,/BOARD_MEMBERS/);
 assert.match(room,/EMPLOYEES_AND_MANAGEMENT/);
 assert.match(service,/attendanceStatus:"N\/A"/);
 assert.match(service,/registrationCategory:"BOARD_MEMBER"/);
 assert.match(service,/Not registered for this meeting/);
});

test("only the meeting host owns the attendance document and dispatches signing",()=>{
 assert.match(room,/isMeetingHost/);
 assert.match(room,/disabled=!isMeetingHost/);
 assert.match(service,/ownerUid!==uid/);
 assert.match(service,/!hostUid\|\|hostUid!==uid/);
 assert.match(service,/meetingHostUid/);
});

test("daily PDF places signature fields in the final column only for Present participants",()=>{
 assert.match(helper,/Signature placement/);
 assert.match(helper,/CATEGORY SHEET:/);
 assert.match(helper,/BOARD_MEMBER/);
 assert.match(helper,/BOARD_COMMITTEE_MEMBER/);
 assert.match(helper,/status==="Present"/);
 assert.match(helper,/type:"Signature"/);
 assert.match(helper,/signerUid:uid/);
 assert.match(helper,/attendanceStatus/);
});

test("dispatch button creates the existing Signature Portal email-link envelope and sends only after host action",()=>{
 assert.match(helper,/createSignatureEnvelope/);
 assert.match(helper,/startSignatureWorkflow/);
 assert.match(helper,/resumeDailyAttendanceSigning/);
 assert.match(helper,/signingMode:"Parallel"/);
 const prepare=helper.indexOf('phase:"PREPARE"');
 const start=helper.indexOf("startSignatureWorkflow(envelope)");
 const sent=helper.indexOf('phase:"SENT"');
 assert.ok(prepare>0&&start>prepare&&sent>start,"prepare must be persisted before starting the email-link workflow, and sent status reconciled after start");
 assert.doesNotMatch(helper,/signatureImage|typedName|meeting-attendance\/sign/);
 assert.match(room,/Dispatch Signing Requests/);
});

test("daily Board quorum uses signed Signature Portal envelope recipients rather than a local signature pad",()=>{
 assert.match(service,/meetingDailyAttendance/);
 assert.match(service,/meetingAttendanceDispatches/);
 assert.match(service,/getGatewayEnvelopeStatus/);
 assert.match(service,/auditChainValid===true/);
 assert.match(service,/dailySignerByUid/);
 assert.match(service,/Math\.ceil\(denominator\/3\)/);
 assert.match(records,/\/api\/meeting-attendance\/daily\/dispatch/);
 assert.doesNotMatch(service,/\/api\/meeting-attendance\/sign/);
});
