import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const participants=fs.readFileSync("src/pages/OperationalGatewaysParticipants.jsx","utf8");
const room=fs.readFileSync("src/pages/MeetingRoom.jsx","utf8");

test("failed meeting invitations expose a guarded resend action and valid gateway link",()=>{
  assert.match(participants,/async function resendInvitation\(i,fromBulk=false\)/);
  assert.match(participants,/isInvitationError\(i\)/);
  assert.match(participants,/Resend Invitation/);
  assert.match(participants,/Resend All Failed\/Error Invitations/);
  assert.match(participants,/createMeetingAccessInvitation/);
  assert.match(participants,/link:meetingGateUrl\.toString\(\)/);
  assert.match(participants,/searchParams\.set\("meetingToken",issued\.accessToken\)/);
  assert.match(participants,/sendMemberInvitationEmail\(i\.email\|\|participant\.participantEmail/);
  assert.match(participants,/resendInFlight\.current\.has\(i\.id\)/);
});

test("resend persists confirmed dispatch or marks failure and revokes the newly issued pass",()=>{
  assert.match(participants,/meetingAccessDispatchStatus:"Confirmed"/);
  assert.match(participants,/meetingAccessDispatched:true/);
  assert.match(participants,/meetingAccessDispatchStatus:"Failed"/);
  assert.match(participants,/revokeMeetingAccessInvitation/);
});

test("failed, undelivered and revoked invitations are excluded from attendance and quorum",()=>{
  assert.match(room,/const attending=useMemo\(\(\)=>participants\.filter\(p=>/);
  assert.match(room,/"failed","error","undelivered"/);
  assert.match(room,/"cancelled","canceled","cancelled invitation","canceled invitation"/);
  assert.match(room,/"failed","error","revoked","undelivered"/);
  assert.match(room,/p\.meetingAccessDispatched!==false/);
  assert.match(room,/const eligible=useMemo\(\(\)=>attending\.filter\(votingRole\)/);
  assert.match(room,/eligiblePresent=useMemo\(\(\)=>present\.filter\(votingRole\)/);
});

test("bulk resend targets only explicit failed or error-reported invitation records",()=>{
  assert.match(participants,/async function resendAllFailedInvitations\(\)/);
  assert.match(participants,/meetingInvitationRows\.filter\(isInvitationError\)/);
  assert.match(participants,/deliveryError/);
  assert.match(participants,/v\.includes\("error"\)/);
  assert.match(participants,/if\(status\.some\(v=>\["cancelled","canceled","cancelled invitation","canceled invitation"\]\.includes\(v\)\)\)return false/);
  assert.match(participants,/resendInFlight\.current\.has\("__bulk__"\)/);
});
