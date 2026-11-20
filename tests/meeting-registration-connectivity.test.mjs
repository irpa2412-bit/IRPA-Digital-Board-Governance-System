import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {canRegisterMeeting} from "../src/firebase/meetingPolicy.js";
const page=fs.readFileSync("src/pages/OperationalGatewaysParticipants.jsx","utf8");
const service=fs.readFileSync("drive-gateway/src/meetingServices.mjs","utf8");
const invite=fs.readFileSync("drive-gateway/src/invitationEmail.mjs","utf8");
const meetings=fs.readFileSync("src/pages/Meetings.jsx","utf8");
test("Meeting registration remains limited to active authorised institutional roles",()=>{
 assert.equal(canRegisterMeeting({active:true,role:"Board Secretary"}),true);
 assert.equal(canRegisterMeeting({active:false,role:"Board Secretary"}),false);
 assert.equal(canRegisterMeeting({active:true,role:"Ordinary Member"}),false);
});
test("meeting participant registration permits shared email addresses but rejects the same participant-position identity",()=>{
 assert.match(page,/same participant identity and position is already registered/);
 assert.match(page,/Shared email addresses are allowed for different people or positions/);
 assert.match(service,/incomingUid/);assert.match(service,/incomingSource/);
 assert.doesNotMatch(service,/existing\.some\(p=>lower\(p\.participantEmail\|\|p\.email\)===participantEmail/);
});
test("invitation records inherit the selected meeting's EAT schedule and email labels the time zone",()=>{
 assert.match(page,/meetingStartAt:m\.startAt/);assert.match(page,/meetingTimeZone:m\.timeZone/);
 assert.match(service,/meetingTimeZone!==EAT_TIME_ZONE/);assert.match(service,/meetingStartAt/);
 assert.match(invite,/meetingStartTime\?" EAT"/);
 assert.match(meetings,/meetingSchedulePayload/);
});
test("Cloudflare validates EAT schedule on meeting create and update",()=>{
 assert.match(service,/meetingDateTimeToIso\(incoming\.date,incoming\.startTime\)/);
 assert.match(service,/Meeting schedule must remain an explicit EAT date\/time/);
});
