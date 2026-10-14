import test from "node:test";
import assert from "node:assert/strict";
import worker, { _test } from "../cloudflare/livekit-production/worker.js";

const origin = "https://irpa-digital-board-governance.web.app";
const env = {
  FIREBASE_PROJECT_ID: "irpa-digital-board-governance",
  FIREBASE_WEB_API_KEY: "test-web-key",
  LIVEKIT_URL: "wss://irpa-livekit-production.example.livekit.cloud",
  LIVEKIT_API_KEY: "prod-api-key",
  LIVEKIT_API_SECRET: "prod-api-secret-value-32-bytes-minimum-123"
};
const enc = value => _test.enc(value);
const doc = (id, value) => ({
  name: "projects/irpa-digital-board-governance/databases/(default)/documents/" + id,
  fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, enc(v)]))
});
function request(path, options = {}) {
  return new Request("https://worker.test" + path, {
    ...options,
    headers: { Origin: origin, ...(options.headers || {}) }
  });
}
test("Firestore typed-value encoding round-trips nested meeting and recording data", () => {
  const input = { id: "abc", title: "Board meeting", active: true, count: 3, size: 1.5, startedAt: new Date("2026-10-14T10:00:00.000Z"), files: [{ name: "record.mp4", size: 17 }], missing: null };
  const decoded = Object.fromEntries(Object.entries(_test.enc(input).mapValue.fields).map(([k, v]) => [k, _test.dec(v)]));
  assert.equal(decoded.title, input.title);
  assert.equal(decoded.active, true);
  assert.equal(decoded.count, 3);
  assert.equal(decoded.size, 1.5);
  assert.equal(decoded.startedAt, "2026-10-14T10:00:00.000Z");
  assert.deepEqual(decoded.files, input.files);
  assert.equal(decoded.missing, null);
});
test("production worker health is reachable without exposing credentials", async () => {
  const response = await worker.fetch(request("/health"), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.environment, "production");
  assert.equal(body.tokenConfigured, true);
  assert.equal(body.recordingStorageConfigured, false);
  assert.equal(JSON.stringify(body).includes("prod-api-secret-value"), false);
});
test("production CORS rejects staging and unknown origins", async () => {
  const response = await worker.fetch(new Request("https://worker.test/token", {
    method: "POST", headers: { Origin: "https://irpa-dgb-meeting-room-staging.irpa-governance.workers.dev", "Content-Type": "application/json" }, body: "{}"
  }), env);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "ORIGIN_NOT_ALLOWED");
});
test("preflight accepts only approved production origins", async () => {
  const good = await worker.fetch(new Request("https://worker.test/token", { method: "OPTIONS", headers: { Origin: origin } }), env);
  assert.equal(good.status, 204);
  assert.equal(good.headers.get("Access-Control-Allow-Origin"), origin);
  const bad = await worker.fetch(new Request("https://worker.test/token", { method: "OPTIONS", headers: { Origin: "https://staging.example" } }), env);
  assert.equal(bad.status, 403);
});
test("token issuance authorizes the live meeting, signs a 10-minute room token, and writes audit", async t => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requests.push({ url: url.toString(), method: init.method || "GET", body: init.body });
    if (url.hostname === "identitytoolkit.googleapis.com") {
      return Response.json({ users: [{ localId: "user-123", email: "chair@example.com", displayName: "Test Chair" }] });
    }
    if (url.pathname.endsWith("/meetings/meeting-123")) {
      return Response.json(doc("meetings/meeting-123", {
        title: "Temporary Board Meeting", status: "In Progress", meetingCategory: "GOVERNANCE",
        initiatorUid: "user-123", chairpersonUid: "user-123", participantUids: ["user-123"], recordingAllowed: true
      }));
    }
    if (url.pathname.endsWith("/members/user-123")) {
      return Response.json(doc("members/user-123", { uid: "user-123", status: "Active", role: "Board Chairperson", boardPosition: "Board Chairperson" }));
    }
    if (url.pathname.endsWith("/employees/user-123") || url.pathname.endsWith("/adminProfiles/user-123")) return new Response("", { status: 404 });
    if (url.pathname.includes("/documents/audit/") && init.method === "PATCH") {
      const body = JSON.parse(init.body);
      return Response.json({ name: "projects/irpa-digital-board-governance/databases/(default)/" + url.pathname.split("/").slice(-2).join("/"), fields: body.fields });
    }
    throw new Error("Unmocked request " + init.method + " " + url.toString());
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const response = await worker.fetch(request("/token", {
    method: "POST",
    headers: { Authorization: "Bearer verified-test-id-token", "Content-Type": "application/json" },
    body: JSON.stringify({ meetingId: "meeting-123", selectedAuthority: "Board Chairperson" })
  }), env);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.moderator, true);
  assert.equal(body.recordingAllowed, true);
  assert.equal(body.expiresInSeconds, 600);
  const jwt = body.participantToken.split(".");
  assert.equal(jwt.length, 3);
  const header = JSON.parse(Buffer.from(jwt[0], "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(jwt[1], "base64url").toString("utf8"));
  assert.equal(header.alg, "HS256");
  assert.equal(claims.iss, "prod-api-key");
  assert.equal(claims.sub, "uid-user-123");
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.roomAdmin, true);
  assert.equal(claims.exp - claims.iat, 600);
  const audit = requests.find(r => r.url.includes("/documents/audit/") && r.method === "PATCH");
  assert.ok(audit, "expected immutable audit create");
  const auditFields = JSON.parse(audit.body).fields;
  assert.equal(auditFields.action.stringValue, "LIVE_MEETING_TOKEN_ISSUED");
  assert.equal(auditFields.actorUid.stringValue, "user-123");
});
test("closed meetings fail closed before token issuance", async t => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "identitytoolkit.googleapis.com") return Response.json({ users: [{ localId: "user-123", email: "chair@example.com" }] });
    if (url.pathname.endsWith("/meetings/meeting-123")) return Response.json(doc("meetings/meeting-123", { status: "Completed", initiatorUid: "user-123" }));
    throw new Error("Unexpected request " + url.toString());
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const response = await worker.fetch(request("/token", {
    method: "POST", headers: { Authorization: "Bearer verified-test-id-token", "Content-Type": "application/json" }, body: JSON.stringify({ meetingId: "meeting-123" })
  }), env);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "MEETING_CLOSED");
});
test("unauthenticated media requests are rejected", async () => {
  const response = await worker.fetch(request("/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meetingId: "meeting-123" }) }), env);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "AUTHENTICATION_REQUIRED");
});
test("recording state mapping distinguishes active, complete, and failed Egress states", () => {
  assert.equal(_test.egressName({ status: 1 }), "EGRESS_ACTIVE");
  assert.equal(_test.recState({ status: 1 }), "RECORDING");
  assert.equal(_test.recState({ status: 3 }), "COMPLETED");
  assert.equal(_test.recState({ status: 4 }), "FAILED");
  assert.equal(_test.recState({ status: 2 }), "STOPPING");
});
test("a Firebase caller token cannot be replaced with client-provided authority", async t => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "identitytoolkit.googleapis.com") return Response.json({ error: { message: "INVALID_ID_TOKEN" } }, { status: 400 });
    throw new Error("Unexpected network request " + url.toString());
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const response = await worker.fetch(request("/token", {
    method: "POST", headers: { Authorization: "Bearer forged-token", "Content-Type": "application/json" }, body: JSON.stringify({ meetingId: "meeting-123", selectedAuthority: "Board Chairperson" })
  }), env);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "INVALID_FIREBASE_ID_TOKEN");
});
