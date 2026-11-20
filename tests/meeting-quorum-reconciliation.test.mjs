import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isBoardMeeting, meetingCapabilities } from "../src/firebase/meetingPolicy.js";

const service=readFileSync("drive-gateway/src/meetingServices.mjs","utf8");
const room=readFileSync("src/pages/MeetingRoom.jsx","utf8");
const api=readFileSync("src/firebase/meetingGatewayApi.js","utf8");
const meetings=readFileSync("src/pages/Meetings.jsx","utf8");

test("only explicit Board and Board Meeting types require the one-third quorum",()=>{
  for(const meetingType of ["Board","Board Meeting"]){
    const meeting={meetingCategory:"GOVERNANCE",meetingType};
    assert.equal(isBoardMeeting(meeting),true);
    assert.equal(meetingCapabilities(meeting).quorumRequired,true);
  }
  for(const meetingType of ["Board Committee Meeting","Annual General Meeting","Special Meeting","Management Meeting","Staff Meeting","General Meeting"]){
    const category=["Board Committee Meeting","Annual General Meeting","Special Meeting"].includes(meetingType)?"GOVERNANCE":meetingType==="Staff Meeting"?"STAFF":"GENERAL";
    const meeting={meetingCategory:category,meetingType};
    assert.equal(isBoardMeeting(meeting),false,meetingType);
    assert.equal(meetingCapabilities(meeting).quorumRequired,false,meetingType);
  }
});

test("server assessment reconciles participant registration, invitation passes, entry queue and signed attendance",()=>{
  assert.match(service,/listByField\(ctx,env,token,"participants","meetingId",meetingId\)/);
  assert.match(service,/listByField\(ctx,env,token,"meetingAccessTokens","meetingId",meetingId\)/);
  assert.match(service,/listByField\(ctx,env,token,"meetingEntryRequests","meetingId",meetingId\)/);
  assert.match(service,/listByField\(ctx,env,token,"meetingAttendanceSignatures","meetingId",meetingId\)/);
  assert.match(service,/Math\.ceil\(boardRows\.length\/3\)/);
  assert.match(service,/lower\(attendanceStatus\)==="present"&&signed/);
  assert.match(service,/category==="BOARD_MEMBER"&&present/);
  assert.match(service,/seenBoardIdentities\.has\(identity\)/);
  assert.match(service,/duplicateBoardMemberRegistrations/);
});

test("Board quorum excludes Board Committee members and external/manual invitees",()=>{
  assert.match(service,/boardMemberRole = participant =>/);
  assert.match(service,/\["board member","board chairperson","board treasurer","board vice chairperson"\]/);
  assert.match(service,/sourceType\)!=="manual invitee"/);
  assert.match(service,/BOARD_COMMITTEE_MEMBER/);
  assert.match(service,/EXTERNAL_INVITEE/);
  assert.match(service,/board secretary\|secretary to the board\|meeting secretary/);
});

test("Cloudflare Worker prevents a Board meeting from starting without quorum",()=>{
  assert.match(service,/lower\(changed\.status\)==="in progress"&&isBoardMeeting\(current\)/);
  assert.match(service,/if\(!assessment\.quorumMet\)return fail/);
  assert.match(service,/A Board meeting cannot start without quorum/);
  assert.match(service,/quorumAssessmentStatus/);
  assert.match(meetings,/p\.id==="GOVERNANCE"\?"Board Meeting"/);
});

test("Meeting Room presents dispatch, queue and signed-attendance reconciliation",()=>{
  assert.match(api,/\/api\/meeting-quorum\/assess/);
  assert.match(room,/Refresh Three-Source Analysis/);
  assert.match(room,/Invitation Dispatch/);
  assert.match(room,/Entry Queue/);
  assert.match(room,/Signed Attendance/);
  assert.match(room,/quorumAssessment\.rows\.map/);
  assert.match(room,/assessMeetingQuorum\(\{meetingId:selected\.id,save\}\)/);
});
