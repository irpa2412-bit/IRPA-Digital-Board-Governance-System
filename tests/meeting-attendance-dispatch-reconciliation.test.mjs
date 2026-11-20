import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const helper=readFileSync("src/firebase/meetingAttendanceSigning.js","utf8");
const service=readFileSync("drive-gateway/src/meetingServices.mjs","utf8");

test("uncertain daily attendance dispatches are marked for reconciliation, not treated as safely retryable failures",()=>{
  assert.match(helper,/phase:"UNCERTAIN"/);
  assert.match(service,/\["PREPARE","SENT","FAILED","UNCERTAIN"\]/);
  assert.match(service,/status:"RECONCILIATION_REQUIRED"/);
  assert.match(service,/reconciliationRequiredAt:now/);
});

test("a reconciliation-required attendance dispatch cannot create a second envelope or resend invitations",()=>{
  assert.match(service,/\["PREPARING","DISPATCHED","RECONCILIATION_REQUIRED"\]/);
  assert.match(service,/Do not create another envelope or resend invitations/);
  assert.match(helper,/dispatch\?\.status==="RECONCILIATION_REQUIRED"/);
});

test("resume refuses to restart a workflow when an existing Signature Portal or Gateway envelope is already recorded",()=>{
  assert.match(helper,/envelope\?\.status!=="Draft"\|\|envelope\?\.gatewayEnvelopeId/);
  assert.match(helper,/Reconcile its current Gateway envelope and invitation status before any retry/);
});

test("uncertain dispatches retain a host-audited Meeting Portal reconciliation state",()=>{
  assert.match(service,/MEETING_DAILY_ATTENDANCE_SIGNING_\+phase/);
  assert.match(service,/dispatchOutcome:phase==="UNCERTAIN"\?"RECONCILIATION_REQUIRED"/);
});

test("host closure records an audited request without revoking or mutating email-link invitations",()=>{
  assert.match(helper,/requestDailyAttendanceSigningClosure/);
  assert.match(helper,/\/api\/meeting-attendance\/daily\/close/);
  assert.match(service,/\/api\/meeting-attendance\/daily\/close/);
  assert.match(service,/PENDING_LINK_LIFECYCLE_FINALIZATION/);
  assert.match(service,/signingLinksRevoked:false/);
  assert.match(service,/MEETING_DAILY_ATTENDANCE_CLOSURE_REQUESTED/);
  assert.match(service,/Completed signatures and audit evidence were left untouched/);
});
