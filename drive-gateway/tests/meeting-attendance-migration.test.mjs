import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gateway = readFileSync(new URL("../src/meetingServices.mjs", import.meta.url), "utf8");
const client = readFileSync(new URL("../../src/firebase/meetingRecords.js", import.meta.url), "utf8");
const dataLayer = readFileSync(new URL("../../src/firebase/data.js", import.meta.url), "utf8");

test("Cloudflare meeting services register the signed-attendance endpoints", () => {
  assert.match(gateway, /"\/api\/meeting-attendance\/sign"/);
  assert.match(gateway, /"\/api\/meeting-attendance\/register"/);
  assert.match(gateway, /pathname==="\/api\/meeting-attendance\/sign"/);
  assert.match(gateway, /pathname==="\/api\/meeting-attendance\/register"/);
});

test("attendance signing validates consent, registration identity, and exact registered name", () => {
  assert.match(gateway, /data\.confirmed!==true/);
  assert.match(gateway, /You may sign only your own registered participant record/);
  assert.match(gateway, /normalizeName\(typedName\)!==normalizeName\(expected\)/);
  assert.match(gateway, /terminal\.has\(lower\(meeting\.status\)\)/);
  assert.match(gateway, /attendanceStatus:"Present"/);
});

test("signature, participant attendance state, and audit record are committed atomically", () => {
  assert.match(gateway, /meetingAttendanceSignatures\/"\+signatureId/);
  assert.match(gateway, /currentDocument:\{exists:false\}/);
  assert.match(gateway, /action:"MEETING_ATTENDANCE_SIGNED"/);
  assert.match(gateway, /await commitWrites\(ctx,env,token,writes\)/);
  assert.match(gateway, /alreadySigned:true/);
});

test("attendance register is restricted to meeting managers or the caller's own participant record", () => {
  assert.match(gateway, /if\(!c\.canManage&&!own\)return fail/);
  assert.match(gateway, /participants\.filter\(p=>c\.canManage\|\|matches\(p\)\)/);
});

test("frontend uses authenticated Cloudflare meeting service rather than Firebase callable dispatch", () => {
  assert.match(client, /callMeetingService\("\/api\/meeting-attendance\/sign",payload\)/);
  assert.match(client, /callMeetingService\("\/api\/meeting-attendance\/register",\{meetingId\}\)/);
  assert.doesNotMatch(client, /call\("signMeetingAttendance"\)/);
  assert.doesNotMatch(client, /call\("getMeetingAttendanceRegister"\)/);
});

const deployWorkflow = readFileSync(new URL("../../.github/workflows/firebase-deploy.yml", import.meta.url), "utf8");
const legacyCallables = readFileSync(new URL("../../functions/meetingAttendanceRegister.js", import.meta.url), "utf8");

test("Firebase deployment no longer blocks release on migrated attendance callables while preserving rollback source", () => {
  assert.match(deployWorkflow, /Confirm meeting attendance is served by Cloudflare/);
  assert.doesNotMatch(deployWorkflow, /deploy --project irpa-digital-board-governance --only functions:signMeetingAttendance,functions:getMeetingAttendanceRegister/);
  assert.match(legacyCallables, /exports\.signMeetingAttendance/);
  assert.match(legacyCallables, /exports\.getMeetingAttendanceRegister/);
});

test("invitation removal uses Cloudflare with server-side administrator and lifecycle guards", () => {
  assert.match(gateway, /pathname==="\/api\/invitations\/remove"/);
  assert.match(gateway, /Only an active IRPA Administrator can remove invitation records/);
  assert.match(gateway, /This invitee is linked to a meeting/);
  assert.match(gateway, /linked to an activated account and cannot be removed/);
  assert.match(gateway, /action:"INVITATION_REGISTER_REMOVE"/);
  assert.match(gateway, /delete:base\+"invitations\/"\+invitationId/);
  assert.ok(dataLayer.includes('gateway+"/api/invitations/remove"'));
  assert.doesNotMatch(dataLayer, /httpsCallable\(getFunctions\(undefined,"us-central1"\),"removeInvitationRecord"\)/);
});

test("billing-blocked callable deploy steps are removed without deleting rollback source", () => {
  assert.match(deployWorkflow, /Confirm meeting attendance is served by Cloudflare/);
  assert.match(deployWorkflow, /Confirm invitation removal is served by Cloudflare/);
  assert.doesNotMatch(deployWorkflow, /deploy --project irpa-digital-board-governance --only functions:signMeetingAttendance,functions:getMeetingAttendanceRegister/);
  assert.doesNotMatch(deployWorkflow, /deploy --project irpa-digital-board-governance --only functions:removeInvitationRecord/);
  assert.match(legacyCallables, /exports\.signMeetingAttendance/);
  assert.match(legacyCallables, /exports\.getMeetingAttendanceRegister/);
  assert.match(readFileSync(new URL("../../functions/index.js", import.meta.url), "utf8"), /exports\.removeInvitationRecord/);
});

test("meeting working-document register, read, and review operations use Cloudflare with meeting-scoped authorization", () => {
  assert.ok(gateway.includes('pathname==="/api/meeting-working-documents/register"'));
  assert.ok(gateway.includes('pathname==="/api/meeting-working-documents/list"'));
  assert.ok(gateway.includes('pathname==="/api/meeting-working-documents/review"'));
  assert.ok(gateway.includes("Only the meeting host, chairperson or secretary may add working documents"));
  assert.ok(gateway.includes("The document must be explicitly linked to this meeting"));
  assert.ok(gateway.includes("Only an authorised meeting participant may review working documents"));
  assert.ok(client.includes('callMeetingService("/api/meeting-working-documents/register",payload)'));
  assert.ok(client.includes('callMeetingService("/api/meeting-working-documents/list",{meetingId})'));
  assert.ok(client.includes('callMeetingService("/api/meeting-working-documents/review",payload)'));
  assert.ok(!client.includes('call("registerMeetingWorkingDocument")'));
  assert.ok(!client.includes('call("listMeetingWorkingDocuments")'));
  assert.ok(!client.includes('call("submitMeetingDocumentReview")'));
});
