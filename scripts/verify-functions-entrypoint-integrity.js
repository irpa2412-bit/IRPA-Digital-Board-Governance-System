import fs from "node:fs";
const source=fs.readFileSync("functions/index.js","utf8");
const required=["trialOnly:true","boardMembersPreserved:true","RESET IRPA TRIAL DATA","exports.resetTrialData"];
for(const token of required){if(!source.includes(token))throw new Error("Missing reset safety marker: "+token);}
if(source.includes('employeeCounters").doc("employees").set({currentNumber:0')||source.includes('memberCounters").doc("members").set({currentNumber:0'))throw new Error("Trial reset must not rewrite production numbering counters.");
console.log("Trial-only reset safety markers present and production counters are preserved.");

const bootstrap=fs.readFileSync("functions/bootstrap.js","utf8");
const meetingGateway=fs.readFileSync("functions/meetingGateway.js","utf8");
if(!bootstrap.includes('...require("./meetingGateway")')) throw new Error("Meeting invitation gateway must be exported from the deployed Functions entrypoint.");
for(const token of ['exports.createMeetingAccessInvitation','exports.revokeMeetingAccessInvitation','exports.authorizeMeetingEntry']) if(!meetingGateway.includes(token)) throw new Error("Missing meeting invitation gateway callable: "+token);
if(!meetingGateway.includes('logger.error("MEETING_INVITATION_ACCESS_ISSUE_FAILED"')) throw new Error("Meeting invitation access failures must emit a structured server diagnostic.");
console.log("Meeting invitation callables are exported and server failures have structured diagnostics.");
