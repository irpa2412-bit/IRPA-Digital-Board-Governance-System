import test from "node:test";
import assert from "node:assert/strict";
import handler from "../src/index.js";

const base = "https://gateway.test";
const env = {
  FIREBASE_PROJECT_ID: "irpa-digital-board-governance",
  ESIGN_MODULE_ENABLED: "true",
  CLOUDFLARE_AUTH_FUNCTIONS_ENABLED: "true",
  DRIVE_MOCK: "true"
};

async function post(path, body = {}) {
  return handler.fetch(new Request(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }), env);
}

test("meeting access issuance is routed through Cloudflare and rejects unauthenticated callers", async () => {
  const response = await post("/api/meeting-access/issue", { meetingId: "m1", participantId: "p1" });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /sign-in|required|session/i);
});

test("meeting access revocation is routed through Cloudflare and rejects unauthenticated callers", async () => {
  const response = await post("/api/meeting-access/revoke", { accessId: "pass1" });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /sign-in|required|session/i);
});

test("meeting entry authorization is routed through Cloudflare and rejects unauthenticated callers", async () => {
  const response = await post("/api/meeting-access/authorize", { accessToken: "invalid", meetingId: "m1", meetingPassword: "bad" });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /sign-in|required|session/i);
});

test("meeting access routes do not accept GET requests", async () => {
  const response = await handler.fetch(new Request(base + "/api/meeting-access/issue"), env);
  assert.equal(response.status, 404);
});
