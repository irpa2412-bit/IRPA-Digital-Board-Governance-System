import test from "node:test";
import assert from "node:assert/strict";
import {buildDailyAttendanceSignerAssignments} from "../src/utils/dailyAttendanceSigners.mjs";
import {meetingDateTimeToIso,meetingDateTimeFromIso,formatMeetingDateTimeEAT,meetingSchedulePayload,EAT_TIME_ZONE} from "../src/utils/meetingTimeEAT.mjs";

test("registered attendance member retains account identity and own signer ID",()=>{
 const [s]=buildDailyAttendanceSignerAssignments([{participantId:"member-1",participantUid:"auth-1",name:"Registered Member",email:"member@example.test"}],"2026-11-20");
 assert.equal(s.accountUid,"auth-1");assert.equal(s.signerUid,"auth-1");assert.equal(s.identityType,"account");assert.equal(s.signerId,"ATT-2026-11-20-member-1");
});
test("unregistered guest receives an account-free email-link identity",()=>{
 const [s]=buildDailyAttendanceSignerAssignments([{participantId:"guest-1",name:"Guest",email:"shared@example.test"}],"2026-11-20");
 assert.equal(s.accountUid,null);assert.equal(s.identityType,"email-link");assert.match(s.signerUid,/^email-link-/);assert.equal(s.signerId,"ATT-2026-11-20-guest-1");
});
test("three positions with one shared email remain three independent signers",()=>{
 const rows=[1,2,3].map(n=>({participantId:"position-"+n,name:"Guest "+n,email:"shared@example.test"}));
 const signers=buildDailyAttendanceSignerAssignments(rows,"2026-11-20");
 assert.equal(new Set(signers.map(s=>s.signerId)).size,3);assert.equal(new Set(signers.map(s=>s.signerUid)).size,3);assert.ok(signers.every(s=>s.email==="shared@example.test"));
});
test("the same signer ID twice is rejected but shared emails are not",()=>{
 const rows=[{participantId:"one",signerId:"SAME",name:"One",email:"x@example.test"},{participantId:"two",signerId:"SAME",name:"Two",email:"x@example.test"}];
 assert.throws(()=>buildDailyAttendanceSignerAssignments(rows,"2026-11-20"),/same signer ID/);
 assert.equal(buildDailyAttendanceSignerAssignments([{participantId:"one",name:"One",email:"x@example.test"},{participantId:"two",name:"Two",email:"x@example.test"}],"2026-11-20").length,2);
});
test("missing signer identity is rejected before dispatch",()=>{
 assert.throws(()=>buildDailyAttendanceSignerAssignments([{name:"Guest",email:"x@example.test"}],"2026-11-20"),/participant ID/);
});
test("EAT schedule round trips midnight and month-end boundaries",()=>{
 assert.equal(EAT_TIME_ZONE,"Africa/Dar_es_Salaam");
 const midnight=meetingDateTimeToIso("2026-12-01","00:00");
 assert.deepEqual(meetingDateTimeFromIso(midnight),{date:"2026-12-01",time:"00:00"});
 const monthEnd=meetingDateTimeToIso("2026-11-30","23:59");
 assert.deepEqual(meetingDateTimeFromIso(monthEnd),{date:"2026-11-30",time:"23:59"});
 assert.match(formatMeetingDateTimeEAT(midnight),/01 Dec 2026, 00:00 EAT/);
});
test("EAT schedule payload persists ISO instants and rejects reversed times",()=>{
 const payload=meetingSchedulePayload({date:"2026-11-30",startTime:"23:00",endTime:"23:59",title:"TEST"});
 assert.equal(payload.timeZone,EAT_TIME_ZONE);assert.ok(payload.startAt<payload.endAt);
 assert.throws(()=>meetingSchedulePayload({date:"2026-11-30",startTime:"23:59",endTime:"00:00"}),/later than its start/);
});
