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


test("attendance-sheet signing dispatch is disabled without mutating legacy dispatch records", async () => {
  const authenticatedContext = {
    ...ctx,
    authenticateFirebaseRequest: async () => ({ user_id: "test-host" })
  };
  const response = await post(createMeetingServicesRouter(authenticatedContext), "/api/meeting-attendance/daily/dispatch", {
    meetingId: "test-meeting",
    date: "2026-11-20",
    phase: "PREPARE",
    envelopeId: "TEST-ENVELOPE",
    documentId: "TEST-DOCUMENT"
  });
  assert.equal(response.status, 410);
  assert.match((await response.json()).error, /temporarily disconnected/i);
});

test("direct attendance signature endpoint is retired in favour of Signature Portal email-link envelopes", async () => {
  assert.equal(await post(createMeetingServicesRouter(ctx), "/api/meeting-attendance/sign", { meetingId: "test-meeting" }), null);
});
