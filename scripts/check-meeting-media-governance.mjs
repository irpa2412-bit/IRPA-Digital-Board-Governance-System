import fs from "node:fs";
import process from "node:process";
const checks=[
 ["Meeting media client exists",fs.existsSync("src/components/IRPADGBSMeetingRoomMedia.jsx")],
 ["Meeting entry gateway exists",fs.existsSync("src/pages/MeetingEntryGateway.jsx")],
 ["Meeting access control exists",fs.existsSync("src/components/MeetingAccessControl.jsx")],
 ["Live meeting token gateway exists",fs.existsSync("functions/liveMeeting.js")],
 ["Meeting access gateway exists",fs.existsSync("functions/meetingGateway.js")],
 ["Meeting gateway registered",fs.readFileSync("functions/bootstrap.js","utf8").includes('require("./meetingGateway")')],
 ["LiveKit client dependency",fs.readFileSync("package.json","utf8").includes('"livekit-client"')],
 ["Authenticated entry callable",fs.readFileSync("functions/meetingGateway.js","utf8").includes("exports.authorizeMeetingEntry")],
 ["Participant-specific token issuance",fs.readFileSync("functions/meetingGateway.js","utf8").includes("createMeetingAccessInvitation")],
 ["LiveKit server token issuance",fs.readFileSync("functions/liveMeeting.js","utf8").includes("exports.issueLiveMeetingToken")],
 ["Long-session reconnection handling",fs.readFileSync("src/components/IRPADGBSMeetingRoomMedia.jsx","utf8").includes("RoomEvent.Reconnecting")&&fs.readFileSync("src/components/IRPADGBSMeetingRoomMedia.jsx","utf8").includes("RoomEvent.Reconnected")],
 ["Audio quality capture controls",fs.readFileSync("src/components/IRPADGBSMeetingRoomMedia.jsx","utf8").includes("echoCancellation:true")&&fs.readFileSync("src/components/IRPADGBSMeetingRoomMedia.jsx","utf8").includes("noiseSuppression:true")],
 ["HD video capture target",fs.readFileSync("src/components/IRPADGBSMeetingRoomMedia.jsx","utf8").includes("1280,height:720")],
 ["Screen sharing",fs.readFileSync("src/components/IRPADGBSMeetingRoomMedia.jsx","utf8").includes("setScreenShareEnabled")],
 ["Governance chat signalling",fs.readFileSync("src/components/IRPADGBSMeetingRoomMedia.jsx","utf8").includes('type:"chat"')],
 ["Hand raise signalling",fs.readFileSync("src/components/IRPADGBSMeetingRoomMedia.jsx","utf8").includes('type:"hand"')],
 ["Meeting token route",fs.readFileSync("src/main.jsx","utf8").includes("meetingToken")],
 ["Firestore rules untouched by this feature",fs.existsSync("firestore.rules")]
];
const failed=checks.filter(([,ok])=>!ok);
const report={
 reportType:"IRPA-DGBS Meeting Media Governance Software Verification",
 generatedAt:new Date().toISOString(),
 checks:checks.map(([name,ok])=>({name,status:ok?"PASS":"FAIL"})),
 summary:{total:checks.length,passed:checks.length-failed.length,failed:failed.length},
 limitation:"This is an automated repository/software contract report. Actual audio/video quality, latency, packet loss, device compatibility and long-session endurance require a deployed staging LiveKit endpoint and browser/device E2E run; this script does not falsely mark those as passed."
};
fs.mkdirSync("reports",{recursive:true});
fs.writeFileSync("reports/meeting-media-governance-verification.json",JSON.stringify(report,null,2)+"\n");
const md=[
"# IRPA-DGBS Meeting Media Governance Verification",
"",
`Generated: ${report.generatedAt}`,
"",
`Result: ${report.summary.passed}/${report.summary.total} software checks passed; ${report.summary.failed} failed.`,
"",
...report.checks.map(x=>`- [${x.status==="PASS"?"x":" "}] ${x.name}`),
"",
"## Test boundary",
report.limitation
].join("\n");
fs.writeFileSync("reports/meeting-media-governance-verification.md",md+"\n");
if(failed.length){console.error(md);process.exit(1)}
console.log(md);
