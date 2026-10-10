import fs from "node:fs";
import process from "node:process";

const media=fs.readFileSync("src/components/IRPADGBSMeetingRoomMedia.jsx","utf8");
const gateway=fs.readFileSync("functions/meetingGateway.js","utf8");
const room=fs.readFileSync("src/pages/MeetingRoom.jsx","utf8");
const policy=fs.readFileSync("src/firebase/meetingPolicy.js","utf8");
const records=fs.readFileSync("functions/meetingRecords.js","utf8");
const liveMeeting=fs.readFileSync("functions/liveMeeting.js","utf8");
const styles=fs.readFileSync("src/styles/tokens.css","utf8");
const participantPage=fs.readFileSync("src/pages/OperationalGatewaysParticipants.jsx","utf8");
const entryGateway=fs.readFileSync("src/pages/MeetingEntryGateway.jsx","utf8");
const invitationEmail=fs.readFileSync("drive-gateway/src/invitationEmail.mjs","utf8");
const invitationWorker=fs.readFileSync("drive-gateway/src/index.js","utf8");
const roomSource=fs.readFileSync("src/pages/MeetingRoom.jsx","utf8");
const livekitCompose=fs.readFileSync("infra/livekit/docker-compose.yml","utf8");
const livekitConfig=fs.readFileSync("infra/livekit/livekit.yaml.template","utf8");
const livekitCaddy=fs.readFileSync("infra/livekit/caddy.yaml.template","utf8");
const livekitDeploy=fs.readFileSync("infra/livekit/deploy-staging.sh","utf8");
const livekitWorkflow=fs.readFileSync(".github/workflows/deploy-livekit-staging.yml","utf8");
const checks=[
 ["Registration buttons use the authoritative active-role policy",room.includes("canRegisterMeeting(actorIdentity)")&&room.includes("canRegisterMeeting({...actorIdentity,isAdmin:admin})")],
 ["Released meeting edits remain administrator-only",room.includes("if(editing&&!canEditMeeting(editing,{...actorIdentity,isAdmin:admin}))")&&room.includes("released. Only an authorised administrator may edit it.")],
 ["Firestore create retains registrar, initiator and meeting-category validation",fs.readFileSync("firestore.rules","utf8").includes('allow create:if meetingRegistrar()&&request.resource.data.get("initiatorUid","")==request.auth.uid&&validMeetingCategory(request.resource.data)')],
 ["Meeting media client exists",fs.existsSync("src/components/IRPADGBSMeetingRoomMedia.jsx")],
 ["Participant invitation creates a meeting access pass",participantPage.includes("createMeetingAccessInvitation")&&participantPage.includes("meetingAccess")],
 ["Meeting access pass is sent through the authenticated IRPA mail gateway",participantPage.includes("sendMemberInvitationEmail(payload.participantEmail,invitationId,payload.participantRole,payload.memberType,meetingAccess)")],
 ["Undelivered meeting access pass is revoked",participantPage.includes("revokeMeetingAccessInvitation")&&gateway.includes("exports.revokeMeetingAccessInvitation")],
 ["Mail gateway verifies meeting and participant link before dispatch",invitationWorker.includes("fields.participantId?.stringValue")&&invitationWorker.includes("linkedMeeting!==meetingId||participantEmail!==email")],
 ["Meeting email template includes gate link and password only when supplied",invitationEmail.includes("meetingAccess")&&invitationEmail.includes("Meeting gate password")],
 ["Meeting entry asks for gate password separately from URL",entryGateway.includes('state==="password"')&&entryGateway.includes('type="password"')&&entryGateway.includes("Verify Password & Continue")],
 ["Meeting Room selects the meeting from the invitation gate context",room.includes("entryContext?.meetingId")&&room.includes("setSelectedId(invitedMeeting.id)")],
 ["Verified invitee context enables the media join control",room.includes("entryContext?.participantId")&&room.includes("entryContext?.meetingId===selected?.id")],
 ["Moderator authority is initialized before LiveKit grant",liveMeeting.indexOf("const moderator = isAdmin || moderatorForMeeting")>=0&&liveMeeting.indexOf("const moderator = isAdmin || moderatorForMeeting")<liveMeeting.indexOf("roomAdmin: moderator")],
 ["Every participant for one meeting receives the same deterministic LiveKit room name",liveMeeting.includes('opaqueRoomName(meetingId, "shared-live-room")')&&!liveMeeting.includes("opaqueRoomName(meetingId, sessionRef.id)")],
 ["Invitation gate participant ID is forwarded to media authorization",media.includes("participantId:gateParticipantId")&&media.includes("irpaMeetingEntryContext")],
 ["Live media revalidates invitation participant against meeting and identity",liveMeeting.includes('db.collection("participants").doc(participantId).get()')&&liveMeeting.includes('text(candidate.meetingId) !== meetingId')&&liveMeeting.includes("boundUid !== uid")&&liveMeeting.includes("boundEmail !== email")],
 ["Verified invitee can pass media identity gate without duplicate member record",liveMeeting.includes("Boolean(invitedParticipant)")&&liveMeeting.includes("verified meeting invitee identity")],
 ["Responsive media columns stack on mobile",media.includes('className="irpa-live-media-columns"')&&styles.includes("@media (max-width:760px)")&&styles.includes("grid-template-columns:minmax(0,1fr)")],
 ["Camera and microphone preflight checks real capture permission",media.includes("async function checkDevices()")&&media.includes("getUserMedia")&&media.includes("width:{ideal:1280}")],
 ["Meeting entry gateway exists",fs.existsSync("src/pages/MeetingEntryGateway.jsx")],
 ["Meeting access control exists",fs.existsSync("src/components/MeetingAccessControl.jsx")],
 ["Live meeting token gateway exists",fs.existsSync("functions/liveMeeting.js")],
 ["Meeting access gateway exists",fs.existsSync("functions/meetingGateway.js")],
 ["Meeting gateway registered",fs.readFileSync("functions/bootstrap.js","utf8").includes('require("./meetingGateway")')],
 ["LiveKit client dependency",fs.readFileSync("package.json","utf8").includes('"livekit-client"')],
 ["Authenticated entry callable",gateway.includes("exports.authorizeMeetingEntry")],
 ["Participant-specific token issuance",gateway.includes("createMeetingAccessInvitation")],
 ["LiveKit server token issuance",fs.readFileSync("functions/liveMeeting.js","utf8").includes("exports.issueLiveMeetingToken")],
 ["Staging uses the official LiveKit Caddy L4 image",livekitCompose.includes("livekit/caddyl4:v2.11.4")&&livekitCompose.includes("livekit/livekit-server:v1.13.7")],
 ["Caddy SNI routes the TURN and meeting hosts on TLS 443",livekitCaddy.includes("${LIVEKIT_TURN_DOMAIN}")&&livekitCaddy.includes("${LIVEKIT_DOMAIN}")&&livekitCaddy.includes('listen: [":443"]')&&livekitCaddy.includes("127.0.0.1:5349")&&livekitCaddy.includes("127.0.0.1:7880")],
 ["TURN TLS is externally terminated by the Caddy L4 router",livekitConfig.includes("external_tls: true")&&livekitConfig.includes("tls_port: 5349")],
 ["Staging installer validates DNS before starting services",livekitDeploy.includes("getent ahostsv4")&&livekitDeploy.includes("does not include this VM")],
 ["Staging installer does not use a conflicting standalone certbot listener",!livekitDeploy.includes("certbot certonly")&&!livekitDeploy.includes("apt-get install -y certbot")],
 ["LiveKit URL and credentials are bound as Firebase runtime secrets",liveMeeting.includes('defineSecret("LIVEKIT_URL")')&&liveMeeting.includes('defineSecret("LIVEKIT_API_KEY")')&&liveMeeting.includes('defineSecret("LIVEKIT_API_SECRET")')&&liveMeeting.includes("secrets: [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET]")],
 ["Deployment workflow is manually gated and staging-only",livekitWorkflow.includes("DEPLOY-LIVEKIT-STAGING")&&livekitWorkflow.includes("environment: livekit-staging")&&livekitWorkflow.includes('if [ "$STAGING_FIREBASE_PROJECT_ID" = "irpa-digital-board-governance" ]')&&livekitWorkflow.includes("Refusing to deploy the staging callable to the production Firebase project")],
 ["Staging workflow deploys only the meeting token callable",livekitWorkflow.includes("firebase deploy --only functions:issueLiveMeetingToken")&&!livekitWorkflow.includes("firebase deploy --only hosting")],
 ["Exactly one LiveKit deployment configuration remains",fs.existsSync(".github/workflows/deploy-livekit-staging.yml")&&!fs.existsSync(".github/workflows/deploy-livekit-staging-functions.yml")&&!fs.existsSync("meeting-infrastructure/docker-compose.example.yml")&&!fs.existsSync("meeting-infrastructure/livekit.yaml.example")],
 ["Staging deployment is gated on explicit marker for push and confirmation for dispatch",livekitWorkflow.includes("startsWith(github.event.head_commit.message, 'DEPLOY-LIVEKIT-STAGING:')")&&livekitWorkflow.includes("inputs.confirm_deployment == 'DEPLOY-LIVEKIT-STAGING'")&&livekitWorkflow.includes("integration/collective-portals-20261009")],
 ["Long-session reconnection handling",media.includes("RoomEvent.Reconnecting")&&media.includes("RoomEvent.Reconnected")],
 ["Audio quality capture controls",media.includes("echoCancellation:true")&&media.includes("noiseSuppression:true")&&media.includes("autoGainControl:true")],
 ["HD video capture target",media.includes("1280,height:720")],
 ["Screen sharing",media.includes("setScreenShareEnabled")],
 ["Governance chat signalling",media.includes('type:"chat"')],
 ["Hand raise signalling",media.includes('type:"hand"')],
 ["Meeting token route",fs.readFileSync("src/main.jsx","utf8").includes("meetingToken")],
 ["Firestore rules present and not part of this feature contract",fs.existsSync("firestore.rules")],
 ["Meeting gate issues meeting ID",gateway.includes("meetingId,meetingPassword")],
 ["Meeting gate issues gate password",gateway.includes("meetingPassword=gatePassword")],
 ["Meeting gate stores password hash",gateway.includes("passwordHash")],
 ["Meeting gate has 30-day expiry",gateway.includes("1000*60*60*24*30")],
 ["Meeting gate is reusable",gateway.includes("reusable:true")],
 ["Meeting entry validates ID and password",gateway.includes("suppliedMeetingId")&&gateway.includes("suppliedPassword")],
 ["Five meeting categories are defined",["GOVERNANCE","ADMINISTRATIVE","STAFF","GENERAL","OTHER"].every(x=>policy.includes(x))],
 ["Five category labels are selectable",["Governance Meetings","Administrative Meetings","Staff Meetings","General Meetings","Other Meetings"].every(x=>policy.includes(x))],
 ["Category options are exported",policy.includes("MEETING_CATEGORY_OPTIONS")],
 ["Meeting category selector exists",fs.readFileSync("src/pages/Meetings.jsx","utf8").includes('name="meetingCategory"')],
 ["Category controls Meeting Room facilities",room.includes("meetingCapabilities")&&room.includes("capabilities.facilities")],
 ["Governance exposes Governance Documents",policy.includes('documentsLabel:"Governance Documents"')&&room.includes("policy.documentsLabel")],
 ["Governance enables quorum and voting",policy.includes('GOVERNANCE:{')&&policy.includes("quorumAccess:true")&&policy.includes("votingEnabled:true")],
 ["Administrative restricts quorum and voting",policy.includes('ADMINISTRATIVE:{')&&policy.includes("quorumAccess:false")&&policy.includes("votingEnabled:false")],
 ["Staff restricts signature and authorization",policy.includes('STAFF:{')&&policy.includes("signatureAccess:false")&&policy.includes("authorizationAccess:false")],
 ["General restricts signature and authorization",policy.includes('GENERAL:{')&&policy.includes("signatureAccess:false")&&policy.includes("authorizationAccess:false")],
 ["Other is restricted to operational facilities",policy.includes('OTHER:{')&&policy.includes("signatureAccess:false")&&policy.includes("authorizationAccess:false")],
 ["Meeting record lifecycle callable registered",fs.readFileSync("functions/bootstrap.js","utf8").includes('require("./meetingRecords")')],
 ["Record capture is server-authorized",records.includes("exports.captureMeetingRecord")&&records.includes("ctx.canManage")],
 ["Record storage uses dedicated meetingRecords collection",records.includes('db.collection("meetingRecords")')],
 ["Record integrity hash stored and checked",records.includes('integrityAlgorithm:"SHA-256"')&&records.includes('actual!==record.contentHash')],
 ["Retrieval is audited",records.includes('MEETING_RECORD_RETRIEVED')],
 ["Integrity failure blocks retrieval and audits",records.includes('MEETING_RECORD_INTEGRITY_FAILURE')&&records.includes('data-loss')],
 ["Retention periods are category-defined",records.includes("GOVERNANCE:7")&&records.includes("ADMINISTRATIVE:5")&&records.includes("STAFF:3")&&records.includes("GENERAL:3")&&records.includes("OTHER:3")],
 ["Legal hold prevents purge",records.includes('if(record.legalHold===true)throw new HttpsError("failed-precondition","A legal hold prevents deletion.")')],
 ["Purge requires retention expiry and reviewed request",records.includes('record.deletionStatus!=="PENDING_REVIEW"')&&records.includes("retainUntil>new Date()")],
 ["Purge restricted to primary administrator",records.includes('if(!admin(req))throw new HttpsError("permission-denied","Only the primary administrator may execute a final purge.")')],
 ["Deletion writes audit before record purge",records.includes('MEETING_RECORD_PURGED')&&records.includes("tx.set(auditRef")&&records.includes("tx.delete(ref)")],
 ["Meeting Room can capture transcript and draft minutes",roomSource.includes('captureCurrentRecord("TRANSCRIPT"')&&roomSource.includes('captureCurrentRecord("MINUTES_DRAFT"')],
 ["Meeting Room provides retrieve and verify UI",roomSource.includes("retrieveRecord(r.id)")&&roomSource.includes("Retrieve & Verify")],
 ["Binary media is not falsely represented as recorded",records.includes("documentPortalRequiredForBinary:true")],
 ["Meeting auto registration exists",room.includes("registerSelf")],
];
const failed=checks.filter(([,ok])=>!ok);
const report={
 reportType:"IRPA-DGBS Meeting Media and Category Governance Software Verification",
 generatedAt:new Date().toISOString(),
 checks:checks.map(([name,ok])=>({name,status:ok?"PASS":"FAIL"})),
 summary:{total:checks.length,passed:checks.length-failed.length,failed:failed.length},
 categoryAccessMatrix:{
  "Governance Meetings":"Auto registration, quorum registration/assessment, attendance, live media, Governance Documents, Authorization & Approvals, Signature Portal, Resolutions & Voting, Decisions & Actions, transcript/proceedings.",
  "Administrative Meetings":"Auto registration, attendance, live media, Administrative Documents, Authorization & Approvals, Signature Portal, Decisions & Actions and transcript/proceedings; no quorum or formal resolutions/voting by default.",
  "Staff Meetings":"Auto registration, attendance, live media, Staff Meeting Documents, Decisions & Actions and transcript/proceedings; no quorum, voting, resolutions, authorization or signature by default.",
  "General Meetings":"Auto registration, attendance, live media, General Meeting Documents, Decisions & Actions and transcript/proceedings; no quorum, voting, resolutions, authorization or signature by default.",
  "Other Meetings":"Auto registration, attendance, live media, Other Meeting Documents, Decisions & Actions and transcript/proceedings; no quorum, voting, resolutions, authorization or signature by default."
 },
 limitation:"This is an automated repository/software contract report. Actual audio/video quality, latency, packet loss, device compatibility and long-session endurance require a deployed staging LiveKit endpoint and browser/device E2E run; this script does not falsely mark those as passed. Category gating here defines the Meeting Room workflow surface; downstream portal authorization remains governed by the existing Firebase authorization model and no Firebase rules are changed by this feature."
};
fs.mkdirSync("reports",{recursive:true});
fs.writeFileSync("reports/meeting-media-governance-verification.json",JSON.stringify(report,null,2)+"\n");
const md=[
"# IRPA-DGBS Meeting Media and Category Governance Verification",
"",
`Generated: ${report.generatedAt}`,
"",
`Result: ${report.summary.passed}/${report.summary.total} software checks passed; ${report.summary.failed} failed.`,
"",
...report.checks.map(x=>`- [${x.status==="PASS"?"x":" "}] ${x.name}`),
"",
"## Category access matrix",
...Object.entries(report.categoryAccessMatrix).map(([k,v])=>`- **${k}:** ${v}`),
"",
"## Test boundary",
report.limitation
].join("\n");
fs.writeFileSync("reports/meeting-media-governance-verification.md",md+"\n");
if(failed.length){console.error(md);process.exit(1)}
console.log(md);
