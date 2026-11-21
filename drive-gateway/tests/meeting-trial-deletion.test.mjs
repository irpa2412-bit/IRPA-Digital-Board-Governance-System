import test from "node:test";
import assert from "node:assert/strict";
import {
  MEETING_CHILD_COLLECTIONS,
  buildMeetingDeletionPreview,
  sanitizeMeetingExport,
  validateMeetingDeletion
} from "../src/meetingDeletion.mjs";
import { isTrialMeeting, meetingEnvironment } from "../src/meetingEnvironment.mjs";

const meeting = {
  id: "trial-1",
  title: "IRPA Trial Board Meeting",
  environment: "TRIAL",
  updateTime: "2026-11-21T20:00:00.000Z"
};
const childRecords = [
  { collection: "participants", record: { id: "p1", meetingId: "trial-1", updateTime: "2026-11-21T20:01:00.000Z", name: "Test Participant", accessToken: "must-not-export" } },
  { collection: "votes", record: { id: "v1", meetingId: "trial-1", updateTime: "2026-11-21T20:02:00.000Z", result: "Pending", tokenHash: "must-not-export" } }
];

test("only the exact TRIAL marker is deletable; missing and invalid environments are REAL", () => {
  assert.equal(meetingEnvironment("TRIAL"), "TRIAL");
  assert.equal(meetingEnvironment("trial"), "REAL");
  assert.equal(meetingEnvironment(undefined), "REAL");
  assert.equal(meetingEnvironment(""), "REAL");
  assert.equal(meetingEnvironment("REAL"), "REAL");
  assert.equal(isTrialMeeting(meeting), true);
  assert.equal(isTrialMeeting({ ...meeting, environment: undefined }), false);
  assert.equal(isTrialMeeting({ ...meeting, environment: "INVALID" }), false);
});

test("the deletion preview covers every meeting-linked Firestore child collection", () => {
  for (const collection of [
    "participants",
    "meetingInvitations",
    "meetingAccessTokens",
    "meetingEntryRequests",
    "meetingAttendanceSignatures",
    "meetingDailyAttendance",
    "meetingAttendanceDispatches",
    "meetingSubscriptions",
    "meetingWorkingDocuments",
    "meetingDocumentReviews",
    "meetingRoomEvents",
    "votes",
    "meetingRecords",
    "resolutions",
    "decisions",
    "meetingMediaRecordings",
    "meetingReportDispatches",
    "liveMeetingSessions",
    "actions",
    "votingIssues"
  ]) assert.ok(MEETING_CHILD_COLLECTIONS.includes(collection), collection);
});

test("preview digest is stable and export strips credentials and bearer tokens", async () => {
  const preview = await buildMeetingDeletionPreview("trial-1", meeting, childRecords);
  const reordered = await buildMeetingDeletionPreview("trial-1", meeting, [...childRecords].reverse());
  assert.equal(preview.previewDigest, reordered.previewDigest);
  assert.equal(preview.childCount, 2);
  assert.deepEqual(preview.collectionCounts, { participants: 1, votes: 1 });
  assert.equal(preview.exportData.children[0].record.accessToken, undefined);
  assert.equal(preview.exportData.children[1].record.tokenHash, undefined);
  assert.equal(preview.exportData.meeting.environment, "TRIAL");
});

test("deletion validation requires a written reason, exact title, current preview and atomic write limit", async () => {
  const preview = await buildMeetingDeletionPreview("trial-1", meeting, childRecords);
  const valid = validateMeetingDeletion({
    meeting,
    reason: "Test meeting cleanup after approval",
    confirmationTitle: meeting.title,
    previewDigest: preview.previewDigest,
    currentDigest: preview.previewDigest,
    childRecords
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.childCount, 2);
  assert.equal(validateMeetingDeletion({
    meeting: { ...meeting, environment: undefined },
    reason: "Cleanup",
    confirmationTitle: meeting.title,
    previewDigest: preview.previewDigest,
    currentDigest: preview.previewDigest,
    childRecords
  }).code, "REAL_MEETING_PROTECTED");
  assert.equal(validateMeetingDeletion({
    meeting,
    reason: "",
    confirmationTitle: meeting.title,
    previewDigest: preview.previewDigest,
    currentDigest: preview.previewDigest,
    childRecords
  }).code, "DELETION_REASON_REQUIRED");
  assert.equal(validateMeetingDeletion({
    meeting,
    reason: "Cleanup",
    confirmationTitle: "Wrong title",
    previewDigest: preview.previewDigest,
    currentDigest: preview.previewDigest,
    childRecords
  }).code, "MEETING_TITLE_CONFIRMATION_MISMATCH");
  assert.equal(validateMeetingDeletion({
    meeting,
    reason: "Cleanup",
    confirmationTitle: meeting.title,
    previewDigest: "stale",
    currentDigest: preview.previewDigest,
    childRecords
  }).code, "MEETING_PREVIEW_STALE");
  assert.equal(validateMeetingDeletion({
    meeting,
    reason: "Cleanup",
    confirmationTitle: meeting.title,
    previewDigest: preview.previewDigest,
    currentDigest: preview.previewDigest,
    childRecords: Array.from({ length: 499 }, (_, index) => ({
      collection: "participants",
      record: { id: String(index), updateTime: meeting.updateTime }
    }))
  }).code, "ATOMIC_DELETE_LIMIT_EXCEEDED");
  assert.equal(validateMeetingDeletion({
    meeting,
    reason: "Cleanup",
    confirmationTitle: meeting.title,
    previewDigest: preview.previewDigest,
    currentDigest: preview.previewDigest,
    childRecords: [{ collection: "participants", record: { id: "missing-version" } }]
  }).code, "CHILD_RECORD_VERSION_UNAVAILABLE");
});

test("export sanitizer recursively removes secret-bearing fields", () => {
  assert.deepEqual(sanitizeMeetingExport({
    title: "Trial",
    nested: { gatewayToken: "secret", note: "keep" }
  }), {
    title: "Trial",
    nested: { note: "keep" }
  });
});
