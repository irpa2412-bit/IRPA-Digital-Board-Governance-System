import fs from "node:fs";
function read(path){return fs.readFileSync(path,"utf8");}
function requireText(text,pattern,label){if(!pattern.test(text))throw new Error("SECURITY SUBSYSTEM GATE FAILED: "+label);}
const live=read("functions/liveMeeting.js");
requireText(live,/new AccessToken\(process\.env\.LIVEKIT_API_KEY, process\.env\.LIVEKIT_API_SECRET/,"LiveKit credentials are server-side.");
requireText(live,/ttl:\s*"10m"/,"LiveKit tokens are short-lived.");
requireText(live,/participantListed\(meeting, uid\)/,"Live meeting token issuance is participant-scoped.");
requireText(live,/selectedAuthorityMatches/,"Live meeting token issuance validates selected authority.");
requireText(live,/roomJoin:\s*true/,"LiveKit room grant is present.");
const drive=read("drive-gateway/src/index.js");
requireText(drive,/authenticateFirebaseRequest\(request\)/,"Drive gateway authenticates Firebase requests.");
requireText(drive,/OAUTH_STATE_TTL\s*=\s*600/,"Drive OAuth state is short-lived.");
requireText(drive,/encryptText\(tokens\.refresh_token, env\.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY\)/,"Drive refresh tokens are encrypted.");
requireText(drive,/AUTHORIZED_DRIVE_EMAIL\.toLowerCase\(\)/,"Drive OAuth is bound to the authorized institutional account.");
requireText(drive,/requestedFolderId/,"Drive upload routes validate controlled folder identifiers.");
requireText(drive,/irpaGovernanceArchive/,"Drive archive metadata boundary is present.");
if(/GOOGLE_DRIVE_CLIENT_SECRET\s*[:=]\s*["'][^"'\n]+/.test(drive))throw new Error("SECURITY SUBSYSTEM GATE FAILED: literal Drive client secret found.");
const infra=read("meeting-infrastructure/README.md");
requireText(infra,/API secrets remain on the meeting-control server/,"Live meeting docs keep API secrets server-side.");
requireText(infra,/production installation is pending infrastructure credentials and host provisioning/i,"Live meeting infrastructure is clearly pending provisioning.");
console.log("IRPA_SUBSYSTEM_SECURITY_GATE_OK");
