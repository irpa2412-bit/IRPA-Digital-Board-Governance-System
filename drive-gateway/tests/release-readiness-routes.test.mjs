import test from "node:test";
import assert from "node:assert/strict";
import { createReleaseReadinessRoute } from "../src/releaseReadinessRoutes.mjs";

function fixture({ admin = true, gateEnabled = true, env = {} } = {}) {
  const calls = [];
  const route = createReleaseReadinessRoute({
    corsHeaders(request) { return { "Access-Control-Allow-Origin": request.headers.get("Origin") || "https://irpa.or.tz", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }; },
    async authenticateFirebaseRequest() { return { user_id: "u1", email: admin ? "irpa2412@gmail.com" : "member@example.org", token: "test-token" }; },
    async getFirestoreDocument(_env, path) {
      if (path === "adminProfiles/u1") return { fields: { active: { booleanValue: admin }, role: { stringValue: admin ? "Administrator" : "Member" } } };
      return null;
    },
    async systemDiagnosticsRoute() {
      calls.push("diagnostics");
      return new Response(JSON.stringify({ adminToken: { created: true }, firestoreRead: { ok: true } }), { status: 200 });
    },
    async actualDataAccessRoute(request) {
      calls.push("actual-data-gate");
      assert.equal(request.method, "GET", "actual-data gate probe must be read-only");
      return new Response(JSON.stringify({ ok: true, enabled: gateEnabled, status: gateEnabled ? "OPEN" : "CLOSED" }), { status: 200 });
    },
    async reconcileSignatureDocumentIds() { throw new Error("release readiness must not auto-discover Drive documents"); }
  });
  return { route, calls, env: { GIT_SHA: "a".repeat(40), FIREBASE_PROJECT_ID: "irpa-digital-board-governance", FIREBASE_SERVICE_ACCOUNT_JSON: "configured-test-only", ...env } };
}
async function call(route, section, env, origin = "https://irpa-digital-board-governance.web.app") {
  return route(new Request("https://worker.test/api/system/release-readiness?section=" + section, {
    method: "POST", headers: { Authorization: "Bearer test-token", Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ section })
  }), env);
}

test("Core section returns JSON and CORS headers when a diagnostic dependency throws", async () => {
  const f = fixture();
  f.route = createReleaseReadinessRoute({
    corsHeaders: () => ({ "Access-Control-Allow-Origin": "https://irpa.or.tz" }),
    async authenticateFirebaseRequest() { return { user_id: "u1", email: "irpa2412@gmail.com", token: "test-token" }; },
    async getFirestoreDocument() { return { fields: { active: { booleanValue: true }, role: { stringValue: "Administrator" } } }; },
    async systemDiagnosticsRoute() { throw new Error("diagnostic dependency exploded"); },
    async actualDataAccessRoute() { throw new Error("gate dependency exploded"); }
  });
  const response = await call(f.route, "core", f.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://irpa.or.tz");
  const body = await response.json();
  assert.ok(body.checks.some(c => c.name === "Firestore diagnostics" && c.status === "FAIL"));
  assert.ok(body.checks.some(c => c.name === "Actual-data gate status" && c.status === "FAIL"));
});

test("non-administrator is refused with JSON and CORS", async () => {
  const f = fixture({ admin: false });
  const response = await call(f.route, "core", f.env);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://irpa-digital-board-governance.web.app");
  assert.match((await response.json()).error, /Administrator authorization/);
});

test("Core section does not invoke Drive auto-discovery reconciliation", async () => {
  const f = fixture();
  const response = await call(f.route, "core", f.env);
  assert.equal(response.status, 200);
  assert.equal(f.calls.includes("diagnostics"), true);
  assert.equal(f.calls.includes("actual-data-gate"), true);
  assert.ok(!(await response.json()).checks.some(c => /Drive ID reconcile/.test(c.name)));
});

test("each integration failure names its integration and exposes no credential value", async () => {
  const f = fixture({ env: {} });
  const response = await call(f.route, "website", f.env);
  assert.equal(response.status, 200);
  const body = await response.json();
  const wp = body.checks.find(c => c.name === "WordPress integration");
  const cp = body.checks.find(c => c.name === "cPanel integration");
  assert.equal(wp.integrationStatus, "BLOCKED");
  assert.equal(wp.errorCode, "MISSING_SETTINGS");
  assert.match(wp.reason, /WORDPRESS_BASE_URL/);
  assert.equal(cp.integrationStatus, "BLOCKED");
  assert.equal(cp.errorCode, "MISSING_SETTINGS");
  assert.match(cp.reason, /CPANEL_BASE_URL/);
  assert.equal(JSON.stringify(body).includes("configured-test-only"), false);
});

test("WordPress probe reports HTTP status and WordPress error code without credentials", async () => {
  const f = fixture({ env: { WORDPRESS_BASE_URL: "https://wp.example.test", WORDPRESS_USERNAME: "editor", WORDPRESS_APPLICATION_PASSWORD: "not-for-output" } });
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: "rest_not_logged_in", message: "Invalid username or password." }), { status: 401, headers: { "Content-Type": "application/json" } });
  try {
    const response = await call(f.route, "website", f.env);
    const body = await response.json();
    const wp = body.checks.find(c => c.name === "WordPress integration");
    assert.equal(wp.integrationStatus, "BLOCKED");
    assert.equal(wp.httpStatus, 401);
    assert.equal(wp.errorCode, "rest_not_logged_in");
    assert.match(wp.reason, /Application Passwords are disabled/);
    assert.equal(JSON.stringify(body).includes("not-for-output"), false);
  } finally { globalThis.fetch = original; }
});

test("hanging outbound WordPress request times out and reports the integration by name", async () => {
  const f = fixture({ env: { WORDPRESS_BASE_URL: "https://wp.example.test", WORDPRESS_USERNAME: "editor", WORDPRESS_APPLICATION_PASSWORD: "test-only" } });
  const original = globalThis.fetch;
  globalThis.fetch = (_url, init = {}) => new Promise((resolve, reject) => {
    if (init.signal?.aborted) reject(new Error("aborted"));
    else init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  try {
    const response = await call(f.route, "website", f.env);
    const body = await response.json();
    const wp = body.checks.find(c => c.name === "WordPress integration");
    assert.equal(wp.integrationStatus, "BLOCKED");
    assert.equal(wp.errorCode, "OUTBOUND_TIMEOUT");
    assert.match(wp.reason, /WordPress request timed out after 8000ms/);
  } finally { globalThis.fetch = original; }
});

test("communications section explicitly reports providers without adapters", async () => {
  const f = fixture();
  const response = await call(f.route, "communications", f.env);
  const body = await response.json();
  for (const name of ["Meta", "LinkedIn", "X", "YouTube", "WhatsApp"]) {
    const check = body.checks.find(c => c.name === name + " publishing");
    assert.equal(check.status, "NEEDS CONFIGURATION");
    assert.equal(check.reason, "credentials not bound and publishing adapter not built");
  }
});

test("unknown section returns a CORS-enabled JSON error naming route and step", async () => {
  const f = fixture();
  const response = await call(f.route, "unknown", f.env);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://irpa-digital-board-governance.web.app");
  const body = await response.json();
  assert.equal(body.route, "/api/system/release-readiness");
  assert.equal(body.step, "Validate section");
});
