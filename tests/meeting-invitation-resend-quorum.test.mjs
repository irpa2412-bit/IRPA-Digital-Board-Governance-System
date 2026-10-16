import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const participants=fs.readFileSync("src/pages/OperationalGatewaysParticipants.jsx","utf8");
const room=fs.readFileSync("src/pages/MeetingRoom.jsx","utf8");

test("failed meeting invitations expose a resend action",()=>{
  assert.match(participants,/async function resendInvitation\(i\)/);
  assert.match(participants,/failed&&<div className="member-actions"[\s\S]*?Resend Invitation/);
  assert.match(participants,/createMeetingAccessInvitation/);
  assert.match(participants,/sendMemberInvitationEmail\(i\.email\|\|participant\.participantEmail/);
});

test("resend persists successful dispatch to invitation and participant records",()=>{
  assert.match(participants,/meetingAccessDispatchStatus:"Confirmed"/);
  assert.match(participants,/invitationStatus:"Invitation Requested"/);
  assert.match(participants,/meetingAccessDispatched:true/);
});

test("failed invitations are excluded from Meeting Room attendance and quorum populations",()=>{
  assert.match(room,/const attending=useMemo\(\(\)=>participants\.filter\(p=>/);
  assert.match(room,/"failed","invitation dispatch failed"/);
  assert.match(room,/"cancelled","canceled","cancelled invitation","canceled invitation"/);
  assert.match(room,/\["failed","revoked"\]/);
  assert.match(room,/p\.meetingAccessDispatched!==false/);
  assert.match(room,/const eligible=useMemo\(\(\)=>attending\.filter\(votingRole\)/);
  assert.match(room,/eligiblePresent=useMemo\(\(\)=>present\.filter\(votingRole\)/);
});


test("organisers can resend all failed or error-reported invitations explicitly",()=>{\n  assert.match(participants,/async function resendAllFailedInvitations\\(\\)/);\n  assert.match(participants,/meetingInvitationRows\\.filter\\(isInvitationError\\)/);\n  assert.match(participants,/Resend All Failed\\/Error Invitations/);\n  assert.match(participants,/deliveryError/);\n  assert.match(participants,/v\\.includes\\("error"\\)/);\n});\n\ntest("error-reported or undelivered invitations are excluded from quorum",()=>{\n  assert.match(room,/"failed","error","undelivered"/);\n  assert.match(room,/includes\\("error"\\)/);\n  assert.match(room,/p\\.meetingAccessDispatched!==false/);\n});\n