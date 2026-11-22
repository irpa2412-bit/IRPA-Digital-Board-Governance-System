import fs from "node:fs";
const source=fs.readFileSync("functions/index.js","utf8");
const bootstrap=fs.readFileSync("functions/bootstrap.js","utf8");
const required=["trialOnly:true","boardMembersPreserved:true","RESET IRPA TRIAL DATA","exports.resetTrialData"];
for(const token of required){if(!source.includes(token))throw new Error("Missing reset safety marker: "+token);}
if(source.includes('employeeCounters").doc("employees").set({currentNumber:0')||source.includes('memberCounters").doc("members").set({currentNumber:0'))throw new Error("Trial reset must not rewrite production numbering counters.");
console.log("Trial-only reset safety markers present and production counters are preserved.");


const meetingGateway=fs.readFileSync("functions/meetingGateway.js","utf8");
const participantsPage=fs.readFileSync("src/pages/OperationalGatewaysParticipants.jsx","utf8");
if(!bootstrap.includes('...require("./meetingGateway")')) throw new Error("Meeting invitation gateway must be exported from the deployed Functions entrypoint.");
for(const token of ["exports.createMeetingAccessInvitation","exports.revokeMeetingAccessInvitation","exports.authorizeMeetingEntry"]) if(!meetingGateway.includes(token)) throw new Error("Missing meeting invitation gateway callable: "+token);
if(!meetingGateway.includes('logger.error("MEETING_INVITATION_ACCESS_ISSUE_FAILED"')) throw new Error("Meeting invitation issuance failures must emit a structured server diagnostic.");
const meetingWorker=fs.readFileSync("drive-gateway/src/meetingPortal.mjs","utf8");
const meetingApi=fs.readFileSync("src/firebase/meetingGatewayApi.js","utf8");
for(const token of ['dispatchStage="issue-meeting-access"','dispatchStage="smtp-dispatch"','meetingAccessDispatchStage:dispatchStage']) if(!participantsPage.includes(token)) throw new Error("Missing independent meeting dispatch-stage tracking: "+token);
if(!meetingWorker.includes('["/api/meeting-invitations/dispatch", "dispatch"]')||!meetingApi.includes('/api/meeting-invitations/dispatch')) throw new Error("Meeting-specific SMTP dispatch route is not wired to the frontend.");
if(participantsPage.includes("sendMemberInvitationEmail")||participantsPage.includes("COLLECTIONS.invitations")) throw new Error("Meeting invitations must not depend on the general Invitation Portal.");
console.log("Legacy meeting callables are retained for rollback; the Meeting Portal uses the independent Worker SMTP route and participant dispatch tracking.");
