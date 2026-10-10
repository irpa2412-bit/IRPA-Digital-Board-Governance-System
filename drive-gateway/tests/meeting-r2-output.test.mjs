import test from "node:test";
import assert from "node:assert/strict";
import { createR2RecordingOutput } from "../src/meetingServices.mjs";

const env = {
  LIVEKIT_EGRESS_R2_ENDPOINT: "https://abc123.r2.cloudflarestorage.com",
  LIVEKIT_EGRESS_R2_BUCKET: "irpa-dbgs-meeting-recordings",
  LIVEKIT_EGRESS_R2_ACCESS_KEY_ID: "test-r2-access-key",
  LIVEKIT_EGRESS_R2_SECRET_ACCESS_KEY: "test-r2-secret-key",
  LIVEKIT_EGRESS_R2_REGION: "auto"
};

test("recording output targets private Cloudflare R2 using path-style S3 access", () => {
  const output = createR2RecordingOutput(env, "irpa-governance-recordings/meeting-123/test.mp4", {
    id: "meeting-123",
    meetingCategory: "GOVERNANCE"
  });
  assert.equal(output.file_type, "MP4");
  assert.equal(output.filepath, "irpa-governance-recordings/meeting-123/test.mp4");
  assert.equal(output.s3.endpoint, "https://abc123.r2.cloudflarestorage.com");
  assert.equal(output.s3.bucket, "irpa-dbgs-meeting-recordings");
  assert.equal(output.s3.region, "auto");
  assert.equal(output.s3.force_path_style, true);
  assert.equal(output.s3.content_disposition, "attachment");
  assert.equal(output.s3.metadata.meeting_id, "meeting-123");
  assert.equal(output.s3.metadata.meeting_category, "GOVERNANCE");
});

test("recording output fails closed when R2 credentials are missing", () => {
  assert.throws(
    () => createR2RecordingOutput({ ...env, LIVEKIT_EGRESS_R2_SECRET_ACCESS_KEY: "" }, "meetings/123/test.mp4"),
    error => error.status === 503
  );
});

test("recording output rejects non-Cloudflare endpoints and unsafe object paths", () => {
  assert.throws(
    () => createR2RecordingOutput({ ...env, LIVEKIT_EGRESS_R2_ENDPOINT: "http://example.com" }, "meetings/123/test.mp4"),
    error => error.status === 503
  );
  assert.throws(
    () => createR2RecordingOutput(env, "meetings/../private/test.mp4"),
    error => error.status === 400
  );
  assert.throws(
    () => createR2RecordingOutput({ ...env, LIVEKIT_EGRESS_R2_REGION: "us-east-1" }, "meetings/123/test.mp4"),
    error => error.status === 503
  );
});
