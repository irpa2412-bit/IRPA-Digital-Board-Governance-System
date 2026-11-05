import test from "node:test";
import assert from "node:assert/strict";
import { classifyFault, runMaintenance, validateUpdateManifest } from "../scripts/website-maintenance-engine.mjs";

test("fault classifier retries transient failures and only allows explicit reversible repairs", () => {
  assert.deepEqual(classifyFault({ code: "http_503" }), { classification: "transient", action: "retry", automatic: true });
  assert.equal(classifyFault({ kind: "cache", safeToClear: true }).action, "cache.clear");
  assert.equal(classifyFault({ kind: "service", service: "php-fpm", serviceRestartApproved: true }).action, "service.restart");
  assert.equal(classifyFault({ kind: "unknown" }).automatic, false);
  assert.equal(classifyFault({ kind: "service", service: "php-fpm" }).automatic, false);
});

test("update manifest requires staging and exact pinned versions", () => {
  assert.deepEqual(validateUpdateManifest({ environment: "staging", updates: [{ type: "plugin", slug: "example-plugin", version: "2.4.1" }] }),
    [{ type: "plugin", slug: "example-plugin", version: "2.4.1" }]);
  assert.throws(() => validateUpdateManifest({ environment: "production", updates: [] }), /staging/);
  assert.throws(() => validateUpdateManifest({ environment: "staging", updates: [{ type: "plugin", slug: "example-plugin", version: "latest" }] }), /pinned version/);
  assert.throws(() => validateUpdateManifest({ environment: "staging", updates: [{ type: "plugin", slug: "../plugin", version: "1.0.0" }] }), /valid exact slug/);
});

test("engine fails closed without adapter credentials and rejects non-staging hosts", async () => {
  const disabled = await runMaintenance({ manifest: { environment: "staging", updates: [] } });
  assert.equal(disabled.status, "disabled");
  await assert.rejects(() => runMaintenance({
    adapterUrl: "https://irpa.or.tz/wp-json/irpa-maintenance/v1",
    token: "not-a-real-token",
    manifest: { environment: "staging", updates: [] }
  }), /outside the exact HTTPS staging endpoint/);
});

test("engine checks backup, health, compatibility, verification and rollback on failed updates", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    let data = {};
    if (path.endsWith("/health")) data = { environment: "staging", siteHost: "staging.irpa.or.tz", healthy: true, faults: [] };
    else if (path.endsWith("/backups/latest")) data = { id: "backup-1", restorable: true, createdAt: new Date().toISOString() };
    else if (path.endsWith("/updates/plan")) data = { compatible: true, environment: "staging" };
    else if (path.endsWith("/updates/apply")) data = { success: false };
    else if (path.endsWith("/rollback")) data = { success: true };
    return { ok: true, status: 200, json: async () => data };
  };
  const result = await runMaintenance({
    adapterUrl: "https://staging.irpa.or.tz/wp-json/irpa-maintenance/v1",
    token: "test-token",
    manifest: { environment: "staging", updates: [{ type: "plugin", slug: "example-plugin", version: "2.4.1" }] },
    fetchImpl
  });
  assert.equal(result.status, "rolled_back");
  assert.ok(calls.some(call => call.path.endsWith("/rollback") && call.method === "POST"));
  assert.ok(calls.every(call => !String(call.path).includes("/content") && !String(call.path).includes("/publish")));
});
