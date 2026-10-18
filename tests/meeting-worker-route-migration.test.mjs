import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('../src/firebase/meetingRecords.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../drive-gateway/src/meetingServices.mjs', import.meta.url), 'utf8');

test('all five formerly undefined meeting callables use authenticated Worker API routes', () => {
  const expected = [
    ['/api/meeting-working-documents/register', 'registerMeetingWorkingDocument'],
    ['/api/meeting-working-documents/list', 'listMeetingWorkingDocuments'],
    ['/api/meeting-working-documents/review', 'submitMeetingDocumentReview'],
    ['/api/meeting-attendance/sign', 'signMeetingAttendance'],
    ['/api/meeting-attendance/register', 'getMeetingAttendanceRegister']
  ];
  for (const [route, name] of expected) {
    assert.ok(client.includes(route), name + ' client route missing');
    assert.ok(worker.includes(route), name + ' Worker route missing');
  }
  for (const name of ['registerMeetingWorkingDocument','listMeetingWorkingDocuments','submitMeetingDocumentReview','signMeetingAttendance','getMeetingAttendanceRegister']) {
    assert.ok(!client.includes('call("' + name + '")'), 'undefined callable remains: ' + name);
  }
  assert.ok(worker.includes('ctx.authenticateFirebaseRequest(request,env)'));
  assert.ok(worker.includes('MEETING_WORKING_DOCUMENT_REVIEW_SUBMITTED'));
  assert.ok(worker.includes('MEETING_ATTENDANCE_SIGNED'));
});

test('Worker keeps document review bounded and attendance signatures identity-bound', () => {
  assert.ok(worker.includes('comment.length>5000'));
  assert.ok(worker.includes('must match the name in your meeting registration'));
  assert.ok(worker.includes('You may sign only your own registered participant record'));
  assert.ok(worker.includes('await commitWrites(ctx,env,token,['), 'attendance signature, participant status, and audit must commit atomically');
  assert.ok(worker.includes('currentDocument:{exists:false}'), 'signature creation must be idempotency-guarded');
  assert.ok(worker.includes('action===\"MEETING_WORKING_DOCUMENT_REVIEW_SUBMITTED\"?\"meetingDocumentReviews\"'), 'review audit events must use the review collection');
  assert.ok(worker.includes('meetingWorkingDocuments'));
  assert.ok(worker.includes('meetingDocumentReviews'));
  assert.ok(worker.includes('meetingAttendanceSignatures'));
});
