import test from "node:test";
import assert from "node:assert/strict";
import {EAT_TIME_ZONE,meetingDateTimeToIso,meetingDateTimeFromIso,formatMeetingDateTimeEAT,meetingSchedulePayload} from "../src/utils/meetingTimeEAT.mjs";
test("Meeting schedules use Africa/Dar_es_Salaam EAT explicitly",()=>{assert.equal(EAT_TIME_ZONE,"Africa/Dar_es_Salaam");});
test("midnight and month-end schedule values round-trip without UTC date drift",()=>{
 const midnight=meetingDateTimeToIso("2026-12-01","00:00");assert.equal(midnight,"2026-11-30T21:00:00.000Z");assert.deepEqual(meetingDateTimeFromIso(midnight),{date:"2026-12-01",time:"00:00"});
 const end=meetingDateTimeToIso("2026-11-30","23:59");assert.equal(end,"2026-11-30T20:59:00.000Z");assert.deepEqual(meetingDateTimeFromIso(end),{date:"2026-11-30",time:"23:59"});
});
test("meeting display includes EAT and preserves optional end time",()=>{
 const start=meetingDateTimeToIso("2026-11-30","23:59");assert.match(formatMeetingDateTimeEAT(start),/EAT/);
 const payload=meetingSchedulePayload({date:"2026-11-30",startTime:"23:00",endTime:"23:59",title:"TEST"});assert.equal(payload.timeZone,EAT_TIME_ZONE);assert.ok(payload.startAt<payload.endAt);
 const noEnd=meetingSchedulePayload({date:"2026-11-30",startTime:"23:00"});assert.equal(noEnd.endAt,null);
});
test("invalid calendar values and reversed meeting times are rejected",()=>{
 assert.throws(()=>meetingDateTimeToIso("2026-02-30","10:00"),/valid calendar date/);
 assert.throws(()=>meetingSchedulePayload({date:"2026-11-30",startTime:"23:59",endTime:"00:00"}),/later than its start/);
});
