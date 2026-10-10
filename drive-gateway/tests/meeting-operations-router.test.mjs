import test from "node:test";
import assert from "node:assert/strict";
import { createMeetingOperationsRouter } from "../src/meetingOperations.mjs";

const ctx = {
  authenticateFirebaseRequest: async () => { throw new Error("Invalid Firebase ID token."); },
  getFirebaseProjectId: () => "test-project",
  getFirestoreAdminAccessToken: async () => "test-admin-token",
  sendMail: async () => "test-message-id",
  json: (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers }),
  corsHeaders: () => ({ "content-type": "application/json" })
};
const post = (router, path, body = {}) => router(new Request("https://worker.test" + path, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer invalid" },
  body: JSON.stringify(body)
}), { FIREBASE_PROJECT_ID: "test-project" }, path);

test("meeting operations router ignores unrelated paths", async () => {
  assert.equal(await post(createMeetingOperationsRouter(ctx), "/api/not-a-meeting-route"), null);
});

test("meeting record endpoints reject invalid Firebase authentication", async () => {
  const router = createMeetingOperationsRouter(ctx);
  for (const path of [
    "/api/meeting-records/capture",
    "/api/meeting-records/draft",
    "/api/meeting-records/list",
    "/api/meeting-records/retrieve",
    "/api/meeting-records/protection",
    "/api/meeting-records/dispose",
    "/api/meeting-proceedings/save",
    "/api/meeting-transcripts/translate",
    "/api/meeting-reports/compile-email",
    "/api/meeting-media/token",
    "/api/meeting-media/recording/start",
    "/api/meeting-media/recording/stop",
    "/api/meeting-media/recording/status"
  ]) {
    const response = await post(router, path);
    assert.equal(response.status, 401, path);
    assert.equal((await response.json()).ok, false, path);
  }
});

test("meeting operations router rejects non-POST requests", async () => {
  const router = createMeetingOperationsRouter(ctx);
  const response = await router(new Request("https://worker.test/api/meeting-records/list", { method: "GET" }), {}, "/api/meeting-records/list");
  assert.equal(response, null);
});
