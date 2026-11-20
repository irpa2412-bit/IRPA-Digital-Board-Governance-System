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
  assert.match(service,/listByField\(ctx,env,token,"meetingDailyAttendance","meetingId",meetingId\)/);
  assert.match(service,/listByField\(ctx,env,token,"meetingAttendanceDispatches","meetingId",meetingId\)/);
  assert.match(service,/getGatewayEnvelopeStatus/);
  assert.match(service,/auditChainValid===true/);
  assert.match(service,/dailySignerByParticipant/);
  assert.match(service,/Math\.ceil\(denominator\/3\)/);
  assert.match(service,/lower\(attendanceStatus\)==="present"&&signed/);
  assert.match(service,/category==="BOARD_MEMBER"&&present/);
  assert.match(service,/registerByUid\.has\(uid\)/);
  assert.match(service,/duplicateBoardMemberRegistrations/);
  assert.match(service,/listCollection\(ctx,env,token,"members"\)/);
  assert.match(service,/boardRegisterMembers:denominator/);
  assert.match(service,/boardMembersNotRegistered/);
});

test("Board quorum excludes Board Committee members and external/manual invitees",()=>{
  assert.match(service,/boardMemberRole = participant =>/);
  assert.match(service,/authoritativeBoardRecord=lower\(participant\.sourceType\)==="board member register"/);
  assert.match(service,/\["board member","board chairperson","board treasurer","board vice chairperson","chairperson","vice chairperson","treasurer"\]/);
  assert.match(service,/external\|guest\|observer\|non\.\?voting\|committee\|secretary/);
  assert.match(service,/lower\(participant\.sourceType\)!=="manual invitee"/);
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
  assert.match(room,/assessMeetingQuorum\(\{meetingId:selected\.id,save,date:dailyAttendanceDate\}\)/);
  assert.match(room,/Dispatch Signing Requests/);
  assert.match(room,/N\/A — Not Attended/);
});

test("Board Register is the authoritative UID-only quorum denominator",()=>{
  assert.match(service,/\/api\/meeting-board-register\/list/);
  assert.match(service,/source:"ACTIVE_BOARD_MEMBERS_REGISTER_UID_ONLY"/);
  assert.match(service,/uid=clean\(member\.uid\|\|member\.authUid\|\|member\.userUid\)/);
  assert.match(service,/const denominator=boardMembers\.length/);
  assert.match(service,/registrationCategory:"BOARD_MEMBER",meetingParticipantRegistered:false/);
  assert.match(service,/UNMATCHED_BOARD_REGISTRATION/);
  assert.match(api,/\/api\/meeting-board-register\/list/);
  assert.match(meetings,/includes\(String\(m\.uid\)\)/);
  assert.match(meetings,/selectedBoardMemberIds:Array\.isArray\(m\.participantUids\)/);
});
test("meeting participant registration cannot redefine the Board Register denominator",()=>{
  assert.match(service,/boardRegister:"active members collection; UID-only; deduplicated by UID"/);
  assert.match(service,/boardMembersNotRegistered/);
  assert.match(service,/duplicateRegisterUids/);
  assert.match(service,/missingRegisterUid/);
  assert.match(service,/!registerUsable\?"NOT_ASSESSABLE"/);
});

test("Meeting Participants portal loads its register directory from Cloudflare and filters Board candidates by UID",()=>{
  const participants=readFileSync("src/pages/OperationalGatewaysParticipants.jsx","utf8");
  assert.match(api,/\/api\/meeting-invitee-directory\/list/);
  assert.match(service,/\/api\/meeting-invitee-directory\/list/);
  assert.match(service,/source:"ACTIVE_REGISTERS_BOARD_UID_ONLY"/);
  assert.match(participants,/listMeetingInviteeDirectory/);
  assert.doesNotMatch(participants,/listMeetingInviteeDirectory.*from"\.\.\/firebase\/data"/);
});
