import test from "node:test";
import assert from "node:assert/strict";
import { createReleaseReadinessRoute } from "../src/releaseReadinessRoutes.mjs";

function fixture({ admin = true, gateEnabled = false } = {}) {
  const calls = [];
  const route = createReleaseReadinessRoute({
    async authenticateFirebaseRequest() { return { user_id: "u1", email: admin ? "irpa2412@gmail.com" : "member@example.org", token: "test-token" }; },
    async getFirestoreDocument(_env, path) {
      if (path === "adminProfiles/u1") return { fields: { active: { booleanValue: admin }, role: { stringValue: admin ? "Administrator" : "Member" } } };
      return null;
    },
    async systemDiagnosticsRoute() {
      return new Response(JSON.stringify({ adminToken: { created: true }, firestoreRead: { ok: true } }), { status: 200 });
    },
    async actualDataAccessRoute(request) {
      assert.equal(request.method, "GET", "actual-data gate probe must be read-only");
      return new Response(JSON.stringify({ ok: true, enabled: gateEnabled, status: gateEnabled ? "OPEN" : "CLOSED" }), { status: 200 });
    },
    async reconcileSignatureDocumentIds(request) {
      assert.equal(request.method, "POST");
      const body = await request.json();
      assert.equal(body.dryRun, true);
      assert.deepEqual(body.documents, []);
      calls.push("reconcile");
      return new Response(JSON.stringify({ ok: true, dryRun: true, writesPerformed: false }), { status: 200 });
    }
  });
  return { route, calls };
}

test("Release Readiness route requires POST and rejects non-administrators", async () => {
  const { route } = fixture({ admin: false });
  const get = await route(new Request("https://worker.test/api/system/release-readiness"), {});
  assert.equal(get.status, 405);
  const post = await route(new Request("https://worker.test/api/system/release-readiness", { method: "POST" }), {});
  assert.equal(post.status, 403);
});

test("Release Readiness runs read-only diagnostics and explicitly reports blocked probes", async () => {
  const { route, calls } = fixture();
  const response = await route(new Request("https://worker.test/api/system/release-readiness", { method: "POST", headers: { Authorization: "Bearer test-token" }, body: "{}" }), {
    GIT_SHA: "a".repeat(40), FIREBASE_PROJECT_ID: "irpa-digital-board-governance", FIREBASE_SERVICE_ACCOUNT_JSON: "{}"
  });
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.workerCommit, "a".repeat(40));
  assert.ok(report.checks.some(item => item.name === "Worker service-account token creation" && item.status === "PASS"));
  assert.ok(report.checks.some(item => item.name === "Drive ID reconcile dry-run" && item.status === "PASS"));
  assert.ok(report.checks.some(item => item.name === "Add-signer dry-run through Worker" && item.status === "FAIL"));
  assert.ok(report.checks.some(item => item.name === "Portal Self-Test (23 probes)" && item.status === "FAIL"));
  assert.deepEqual(calls, ["reconcile"]);
});

test("closed actual-data gate names the exact gate", async () => {
  const { route } = fixture({ gateEnabled: false });
  const response = await route(new Request("https://worker.test/api/system/release-readiness", { method: "POST" }), {
    GIT_SHA: "a".repeat(40), FIREBASE_PROJECT_ID: "irpa-digital-board-governance"
  });
  const report = await response.json();
  const gate = report.checks.find(item => item.name === "Actual-data gate status");
  assert.equal(gate.status, "FAIL");
  assert.match(gate.reason, /systemSettings\/actualDataAccess/);
});
