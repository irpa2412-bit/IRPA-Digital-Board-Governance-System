import { isTrialMeeting } from "./meetingEnvironment.mjs";

export const MEETING_CHILD_COLLECTIONS = Object.freeze([
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
]);

const clean = value => String(value ?? "").trim();
const sensitiveKey = /token|secret|password|authorization|credential|private.?key|api.?key|signature(?:image|data|base64|blob)/i;

export function sanitizeMeetingExport(value) {
  if (Array.isArray(value)) return value.map(sanitizeMeetingExport);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveKey.test(key))
      .map(([key, item]) => [key, sanitizeMeetingExport(item)])
  );
}

export async function buildMeetingDeletionPreview(meetingId, meeting, childRecords) {
  const rows = childRecords.map(({ collection, record }) => ({
    collection,
    id: clean(record?.id),
    updateTime: clean(record?.updateTime)
  })).sort((a, b) =>
    a.collection.localeCompare(b.collection) ||
    a.id.localeCompare(b.id) ||
    a.updateTime.localeCompare(b.updateTime)
  );

  const digestSource = JSON.stringify({
    meetingId: clean(meetingId),
    meetingUpdateTime: clean(meeting?.updateTime),
    children: rows
  });
  const digestBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(digestSource));
  const previewDigest = [...new Uint8Array(digestBytes)]
    .map(value => value.toString(16).padStart(2, "0"))
    .join("");

  const collectionCounts = {};
  for (const row of rows) collectionCounts[row.collection] = (collectionCounts[row.collection] || 0) + 1;

  const externalArtifactsNotice = "External Google Drive source files and media binaries are not deleted by this Firestore atomic operation. The JSON export contains their linked metadata only.";
  return {
    previewDigest,
    childCount: rows.length,
    collectionCounts,
    externalArtifactsNotice,
    exportData: {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      externalArtifactsNotice,
      meeting: sanitizeMeetingExport({ ...meeting, id: clean(meetingId) }),
      children: childRecords.map(({ collection, record }) => ({
        collection,
        record: sanitizeMeetingExport(record)
      }))
    }
  };
}

export function validateMeetingDeletion({
  meeting,
  reason,
  confirmationTitle,
  previewDigest,
  currentDigest,
  childRecords
}) {
  if (!isTrialMeeting(meeting)) {
    return { ok: false, status: 409, code: "REAL_MEETING_PROTECTED", message: "Only meetings explicitly created as TRIAL can be deleted. Missing or invalid environment is treated as REAL." };
  }
  if (childRecords.some(({ collection }) => collection === "meetingRecords")) {
    return { ok: false, status: 409, code: "MEETING_RECORD_DISPOSITION_REQUIRED", message: "Linked authoritative meeting records must first pass their own legal-hold, retention and pending-review disposition workflow. No meeting or child records were deleted." };
  }
  if (!clean(meeting?.updateTime)) {
    return { ok: false, status: 409, code: "MEETING_VERSION_UNAVAILABLE", message: "The meeting version could not be verified; deletion was blocked." };
  }
  const normalizedReason = clean(reason);
  if (!normalizedReason || normalizedReason.length > 1000) {
    return { ok: false, status: 400, code: "DELETION_REASON_REQUIRED", message: "A written deletion reason of 1 to 1000 characters is required." };
  }
  const title = clean(meeting?.title);
  if (!title || clean(confirmationTitle) !== title) {
    return { ok: false, status: 409, code: "MEETING_TITLE_CONFIRMATION_MISMATCH", message: "Type the exact meeting title to confirm deletion. No records were deleted." };
  }
  if (!clean(previewDigest) || clean(previewDigest) !== clean(currentDigest)) {
    return { ok: false, status: 409, code: "MEETING_PREVIEW_STALE", message: "Meeting data changed after the preview. Refresh the preview and review it again before deletion." };
  }
  if (!Array.isArray(childRecords) || childRecords.some(({ record }) => !clean(record?.id) || !clean(record?.updateTime))) {
    return { ok: false, status: 409, code: "CHILD_RECORD_VERSION_UNAVAILABLE", message: "At least one linked record has no verifiable version; deletion was blocked." };
  }
  if (childRecords.length + 2 > 500) {
    return { ok: false, status: 409, code: "ATOMIC_DELETE_LIMIT_EXCEEDED", message: "The linked records exceed Firestore's atomic deletion limit. No records were deleted." };
  }
  const collectionCounts = {};
  for (const { collection } of childRecords) collectionCounts[collection] = (collectionCounts[collection] || 0) + 1;
  return {
    ok: true,
    reason: normalizedReason,
    confirmationTitle: title,
    childCount: childRecords.length,
    collectionCounts
  };
}


export function validateMeetingRecordPurge({ meeting, record, now = new Date() }) {
  if (!isTrialMeeting(meeting)) {
    return { ok: false, status: 409, code: "REAL_MEETING_PROTECTED", message: "Meeting records linked to REAL or unclassified meetings cannot be purged. Only explicitly TRIAL meetings qualify." };
  }
  if (record?.legalHold === true) {
    return { ok: false, status: 409, code: "LEGAL_HOLD_ACTIVE", message: "A legal hold prevents deletion." };
  }
  if (new Date(record?.retainUntil || 8640000000000000) > now) {
    return { ok: false, status: 409, code: "RETENTION_NOT_EXPIRED", message: "The retention period has not expired." };
  }
  if (record?.deletionStatus !== "PENDING_REVIEW") {
    return { ok: false, status: 409, code: "DISPOSITION_REVIEW_REQUIRED", message: "A deletion request and review are required before purge." };
  }
  if (!record?.updateTime) {
    return { ok: false, status: 409, code: "RECORD_VERSION_UNAVAILABLE", message: "The record version could not be verified; purge was blocked safely." };
  }
  return { ok: true };
}
