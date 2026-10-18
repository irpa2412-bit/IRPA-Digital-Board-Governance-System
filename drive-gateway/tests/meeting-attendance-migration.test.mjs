import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gateway = readFileSync(new URL("../src/meetingServices.mjs", import.meta.url), "utf8");
const client = readFileSync(new URL("../../src/firebase/meetingRecords.js", import.meta.url), "utf8");

test("Cloudflare meeting services register the signed-attendance endpoints", () => {
  assert.match(gateway, /"\/api\/meeting-attendance\/sign"/);
  assert.match(gateway, /"\/api\/meeting-attendance\/register"/);
  assert.match(gateway, /pathname==="\/api\/meeting-attendance\/sign"/);
  assert.match(gateway, /pathname==="\/api\/meeting-attendance\/register"/);
});

test("attendance signing validates consent, registration identity, and exact registered name", () => {
  assert.match(gateway, /data\.confirmed!==true/);
  assert.match(gateway, /You may sign only your own registered participant record/);
  assert.match(gateway, /normalizeName\(typedName\)!==normalizeName\(expected\)/);
  assert.match(gateway, /terminal\.has\(lower\(meeting\.status\)\)/);
  assert.match(gateway, /attendanceStatus:"Present"/);
});

test("signature, participant attendance state, and audit record are committed atomically", () => {
  assert.match(gateway, /meetingAttendanceSignatures\/"\+signatureId/);
  assert.match(gateway, /currentDocument:\{exists:false\}/);
  assert.match(gateway, /action:"MEETING_ATTENDANCE_SIGNED"/);
  assert.match(gateway, /await commitWrites\(ctx,env,token,writes\)/);
  assert.match(gateway, /alreadySigned:true/);
});

test("attendance register is restricted to meeting managers or the caller's own participant record", () => {
  assert.match(gateway, /if\(!c\.canManage&&!own\)return fail/);
  assert.match(gateway, /participants\.filter\(p=>c\.canManage\|\|matches\(p\)\)/);
});

test("frontend uses authenticated Cloudflare meeting service rather than Firebase callable dispatch", () => {
  assert.match(client, /callMeetingService\("\/api\/meeting-attendance\/sign",payload\)/);
  assert.match(client, /callMeetingService\("\/api\/meeting-attendance\/register",\{meetingId\}\)/);
  assert.doesNotMatch(client, /call\("signMeetingAttendance"\)/);
  assert.doesNotMatch(client, /call\("getMeetingAttendanceRegister"\)/);
});
