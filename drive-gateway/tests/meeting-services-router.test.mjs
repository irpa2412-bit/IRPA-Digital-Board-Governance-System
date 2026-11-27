import test from "node:test";
import assert from "node:assert/strict";
import { createMeetingServicesRouter } from "../src/meetingServices.mjs";

const ctx = {
  authenticateFirebaseRequest: async () => { throw new Error("Firebase authentication is required."); },
  getFirebaseProjectId: () => "test-project",
  getFirestoreAdminAccessToken: async () => "test-token",
  sendEmail: async () => "test-message-id",
  json: (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers }),
  corsHeaders: () => ({ "content-type": "application/json" })
};
const post = (router, path, body = {}) => router(new Request("https://worker.test" + path, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
}), { FIREBASE_PROJECT_ID: "test-project" }, path);

test("meeting services router ignores unrelated paths", async () => {
  assert.equal(await post(createMeetingServicesRouter(ctx), "/api/not-a-meeting-service"), null);
});

test("meeting record operations require Firebase-authenticated identity", async () => {
  const response = await post(createMeetingServicesRouter(ctx), "/api/meeting-records/capture", {
    meetingId: "test-meeting",
    recordType: "MINUTES_DRAFT",
    content: "Non-confidential test minutes"
  });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /sign-in/i);
});

test("LiveKit token issuance also requires an authenticated identity", async () => {
  const response = await post(createMeetingServicesRouter(ctx), "/api/meeting-media/token", {
    meetingId: "test-meeting",
    selectedAuthority: "Board Member"
  });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /sign-in/i);
});

test("meeting register, decision, and voting control routes require authenticated identity", async () => {
  const router = createMeetingServicesRouter(ctx);
  for (const path of [
    "/api/meeting-register/create",
    "/api/meeting-register/update",
    "/api/meeting-register/delete",
    "/api/meeting-decisions/create",
    "/api/meeting-actions/create",
    "/api/meeting-voting/open",
    "/api/meeting-voting/close",
    "/api/meeting-voting/participant-list",
    "/api/meeting-outcomes/public",
    "/api/meeting-resolutions/create",
    "/api/meeting-resolutions/update",
    "/api/meeting-resolutions/delete",
    "/api/meeting-participants/create",
    "/api/meeting-participants/update",
    "/api/meeting-participants/delete",
    "/api/meeting-room/activity",
    "/api/meeting-room/event",
    "/api/meeting-subscriptions/mine",
    "/api/meeting-entry-requests/list",
    "/api/meeting-entry-requests/resolve",
    "/api/meeting-attendance/register",
    "/api/meeting-attendance/mark",
    "/api/meeting-attendance/daily/register",
    "/api/meeting-attendance/daily/mark",
    "/api/meeting-attendance/daily/dispatch",
    "/api/meeting-working-documents/register",
    "/api/meeting-working-documents/list",
    "/api/meeting-working-documents/review"
  ]) {
    const response = await post(router, path, { meetingId: "test-meeting" });
    assert.equal(response.status, 401, path);
    assert.match((await response.json()).error, /sign-in/i, path);
  }
});


test("closed vote summaries aggregate only counts and preserve the tie result", async () => {
  const { summarizeMeetingVotes } = await import("../src/meetingServices.mjs");
  const summary = summarizeMeetingVotes([
    { outcome: "For" }, { outcome: "For" }, { outcome: "Against" },
    { outcome: "Abstain" }, { outcome: "Unknown" }
  ]);
  assert.deepEqual(summary, {
    tallies: { For: 2, Against: 1, Abstain: 1, total: 4 },
    result: "Passed"
  });
  assert.equal(summarizeMeetingVotes([{ outcome: "For" }, { outcome: "Against" }]).result, "Pending");
});

test("archived meeting records are retrievable without treating unknown status as active", async () => {
  const { isRetrievableMeetingRecordStatus } = await import("../src/meetingServices.mjs");
  assert.equal(isRetrievableMeetingRecordStatus("Active"), true);
  assert.equal(isRetrievableMeetingRecordStatus("Archived"), true);
  assert.equal(isRetrievableMeetingRecordStatus("ARCHIVED"), true);
  assert.equal(isRetrievableMeetingRecordStatus("Deleted"), false);
  assert.equal(isRetrievableMeetingRecordStatus(""), false);
});

test("direct attendance signature endpoint is retired in favour of Signature Portal email-link envelopes", async () => {
  assert.equal(await post(createMeetingServicesRouter(ctx), "/api/meeting-attendance/sign", { meetingId: "test-meeting" }), null);
});
