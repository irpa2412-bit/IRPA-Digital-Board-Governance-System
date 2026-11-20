import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const policy=readFileSync("src/firebase/meetingPolicy.js","utf8");
const meetings=readFileSync("src/pages/Meetings.jsx","utf8");
const room=readFileSync("src/pages/MeetingRoom.jsx","utf8");
const invitations=readFileSync("drive-gateway/src/invitationEmail.mjs","utf8");

test("meeting records default to the East Africa IANA timezone",()=>{
 assert.ok(policy.includes('meetingTimeZone:meeting.meetingTimeZone||"Africa/Nairobi"'));
 assert.ok(policy.includes('meetingTimeLabel:"EAT (UTC+3)"'));
 assert.ok(meetings.includes('meetingTimeZone:"Africa/Nairobi"'));
});

test("meeting registration clearly labels input times as EAT regardless of device timezone",()=>{
 assert.ok(meetings.includes("Start Time (EAT)"));
 assert.ok(meetings.includes("End Time (EAT)"));
 assert.ok(meetings.includes("regardless of the device timezone"));
});

test("meeting summaries, schedules, and minutes display EAT explicitly",()=>{
 assert.ok(meetings.includes("Time: ${meeting.startTime||"));
 assert.ok(meetings.includes('EAT (UTC+3)'));
 assert.ok(room.includes('EAT (UTC+3)'));
});

test("meeting invitation email includes EAT with the scheduled time",()=>{
 assert.ok(invitations.includes('meetingTimeZone=detail(meetingAccess.meetingTimeZone||"EAT (UTC+3)"'));
 assert.ok(invitations.includes('${meetingTime||"Not recorded"} ${meetingTimeZone}'));
});
