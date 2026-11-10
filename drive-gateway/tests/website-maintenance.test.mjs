import test from "node:test";
import assert from "node:assert/strict";
import { createCommunicationsSiteRouter } from "../src/communicationsSite.mjs";

function makeHarness({ administrator = true, initial = "<p>original</p>", environment = "staging", liveRoot = "" } = {}) {
  const stored = new Map(), events = [], writes = [], wordpressMethods = [];
  let current = initial;
  const router = createCommunicationsSiteRouter({
    authenticateFirebaseRequest: async () => ({ user_id: "maintenance-user", email: "maintenance@example.test", token: "test-token" }),
    getFirestoreDocument: async () => ({ active: administrator }),
    getInstitutionalProfileForUser: async () => ({ memberRecord: null, employeeRecord: null }),
    firestoreDocumentToPlain: value => value,
    commitDocumentAndAudit: async (...args) => { events.push(args); },
    json: (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } }),
    corsHeaders: () => ({})
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof URL ? input.href : String(input));
    const params = new URLSearchParams(url.search);
    const method = init.method || "GET";
    if (url.pathname.includes("/wp-json/wp/v2/")) {
      wordpressMethods.push(method);
      if (url.pathname.endsWith("/plugins")) return new Response(JSON.stringify([{ version: "1.0", update_available: true }]), { status: 200 });
      if (url.pathname.endsWith("/themes")) return new Response(JSON.stringify([{ version: "2.0", update_available: false }]), { status: 200 });
      return new Response(JSON.stringify({ code: "rest_no_route" }), { status: 404 });
    }
    if (url.pathname.endsWith("/Fileman/get_file_content")) return new Response(JSON.stringify({ status: 1, data: { content: current } }), { status: 200 });
    if (url.pathname.endsWith("/Fileman/save_file_content")) {
      assert.ok([...stored.values()].length > 0, "snapshot must be stored before cPanel write");
      current = params.get("content") || new URLSearchParams(init.body).get("content") || "";
      writes.push({ method, content: current, params: new URLSearchParams(init.body || "") });
      return new Response(JSON.stringify({ status: 1, data: {} }), { status: 200 });
    }
    throw new Error("Unexpected cPanel request: " + url.pathname);
  };
  const env = {
    IRPA_ENVIRONMENT: environment, IRPA_WORKER_ENVIRONMENT: environment,
    CPANEL_BASE_URL: "https://cpanel.test:2083", CPANEL_USERNAME: "testcp", CPANEL_API_TOKEN: "test-token",
    CPANEL_DOCUMENT_ROOT: "public_html/staging",
    WORDPRESS_BASE_URL: "https://staging.irpa.or.tz",
    WORDPRESS_USERNAME: "website-editor",
    WORDPRESS_APPLICATION_PASSWORD: "test-wordpress-password",
    ...(liveRoot ? { CPANEL_LIVE_DOCUMENT_ROOT: liveRoot } : {}),
    DRIVE_KV: {
      async put(key, value) { stored.set(key, JSON.parse(value)); },
      async get(key) { return stored.get(key) || null; }
    }
  };
  async function request(path, method = "GET", body) {
    return router(new Request("https://gateway.test" + path, {
      method, headers: { Authorization: "Bearer test", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    }), env);
  }
  return { request, stored, events, writes, wordpressMethods, get current() { return current; }, restore() { globalThis.fetch = originalFetch; } };
}

test("website maintenance rejects path traversal and blocked paths with HTTP 400", async () => {
  const h = makeHarness();
  try {
    for (const path of ["../secret.html", "portal-test/../../secret.html", "wp-admin/index.html", "wp-includes/test.css", "uploads/file.txt", ".htaccess", "wp-config.php", "portal-test/.user.ini"]) {
      const response = await h.request("/api/communications/cpanel/maintenance/files", "PUT", { path, content: "x", reason: "Valid reason for test" });
      assert.equal(response.status, 400, path);
      assert.equal((await response.json()).error, "Invalid website file path.");
    }
  } finally { h.restore(); }
});

test("website maintenance rejects executable and unsupported extensions", async () => {
  const h = makeHarness();
  try {
    for (const path of ["portal-test/shell.php", "portal-test/run.sh", "portal-test/file.exe", "portal-test/file.js"]) {
      const response = await h.request("/api/communications/cpanel/maintenance/files", "PUT", { path, content: "x", reason: "Valid reason for test" });
      assert.equal(response.status, 400, path);
    }
  } finally { h.restore(); }
});

test("website maintenance enforces the 512 KiB write limit", async () => {
  const h = makeHarness();
  try {
    const response = await h.request("/api/communications/cpanel/maintenance/files", "PUT", { path: "portal-test/large.txt", content: "x".repeat(512 * 1024 + 1), reason: "Valid reason for test" });
    assert.equal(response.status, 413);
    assert.equal(h.writes.length, 0);
  } finally { h.restore(); }
});

test("website maintenance snapshots before write and records a mandatory reason", async () => {
  const h = makeHarness({ initial: "original bytes" });
  try {
    const response = await h.request("/api/communications/cpanel/maintenance/files", "PUT", { path: "portal-test/acceptance.txt", content: "new bytes", reason: "Update staging acceptance content" });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.ok(data.backupId);
    assert.equal(h.stored.get(data.backupId).content, "original bytes");
    assert.equal(h.current, "new bytes");
    assert.ok(h.events.length > 0);
    assert.match(JSON.stringify(h.events), /Update staging acceptance content/);
  } finally { h.restore(); }
});

test("website maintenance rollback restores the exact original bytes", async () => {
  const exact = "line one\r\nline two\u0000tail";
  const h = makeHarness({ initial: exact });
  try {
    const saved = await h.request("/api/communications/cpanel/maintenance/files", "PUT", { path: "portal-test/rollback.txt", content: "changed", reason: "Test exact byte rollback" });
    const backupId = (await saved.json()).backupId;
    const rolled = await h.request("/api/communications/cpanel/maintenance/rollback", "POST", { path: "portal-test/rollback.txt", backupId, reason: "Test exact byte rollback" });
    assert.equal(rolled.status, 200);
    assert.equal(h.current, exact);
  } finally { h.restore(); }
});

test("website maintenance promotion requires exact typed confirmation", async () => {
  const h = makeHarness();
  try {
    const response = await h.request("/api/communications/cpanel/maintenance/promote", "POST", { path: "portal-test/acceptance.txt", reason: "Promote verified staging file", confirmation: "yes" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /PROMOTE TO LIVE/);
    assert.equal(h.writes.length, 0);
  } finally { h.restore(); }
});

test("non-administrator cannot edit website files", async () => {
  const h = makeHarness({ administrator: false });
  try {
    const response = await h.request("/api/communications/cpanel/maintenance/files", "PUT", { path: "portal-test/no.txt", content: "blocked", reason: "Valid reason for test" });
    assert.equal(response.status, 403);
    assert.equal(h.writes.length, 0);
  } finally { h.restore(); }
});

test("website maintenance promotion snapshots live bytes before the confirmed copy", async () => {
  const h = makeHarness({ initial: "live original", liveRoot: "public_html" });
  try {
    const response = await h.request("/api/communications/cpanel/maintenance/promote", "POST", { path: "portal-test/promote.txt", reason: "Promote verified staging file", confirmation: "PROMOTE TO LIVE" });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.ok(data.snapshotId);
    assert.equal(h.stored.get(data.snapshotId).content, "live original");
    assert.equal(h.current, "live original");
  } finally { h.restore(); }
});

test("legacy cPanel file PUT returns HTTP 400 for an invalid website path", async () => {
  const h = makeHarness();
  try {
    const response = await h.request("/api/communications/cpanel/files", "PUT", { path: "../secret.html", content: "blocked", reason: "Legacy route validation test" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "Invalid website file path.");
    assert.equal(h.writes.length, 0);
  } finally { h.restore(); }
});

test("website maintenance refuses to overwrite an existing file larger than 512 KiB", async () => {
  const h = makeHarness({ initial: "x".repeat(512 * 1024 + 1) });
  try {
    const response = await h.request("/api/communications/cpanel/maintenance/files", "PUT", { path: "portal-test/large-existing.txt", content: "small replacement", reason: "Do not overwrite oversized source" });
    assert.equal(response.status, 413);
    assert.equal(h.writes.length, 0);
    assert.equal(h.stored.size, 0);
  } finally { h.restore(); }
});

test("production cPanel diagnostics fail closed with HTTP 409 when the live root is unset", async () => {
  const h = makeHarness({ environment: "production" });
  try {
    const response = await h.request("/api/communications/cpanel/diagnostics?domain=irpa.or.tz");
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "Live root not configured" });
    assert.equal(h.writes.length, 0);
  } finally { h.restore(); }
});

test("staging-to-live promotion fails closed with HTTP 409 when the live root is unset", async () => {
  const h = makeHarness();
  try {
    const response = await h.request("/api/communications/cpanel/maintenance/promote", "POST", {
      path: "portal-test/acceptance.txt",
      reason: "Promote verified staging file",
      confirmation: "PROMOTE TO LIVE"
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "Live root not configured" });
    assert.equal(h.writes.length, 0);
  } finally { h.restore(); }
});

test("live-root readiness is read-only and returns HTTP 409 when not configured", async () => {
  const h = makeHarness();
  try {
    const response = await h.request("/api/communications/cpanel/maintenance/live-root-status");
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      readOnly: true,
      configured: false,
      status: "not exposed",
      reason: "Live root not configured"
    });
    assert.equal(h.writes.length, 0);
  } finally { h.restore(); }
});

test("WordPress update checks use GET only and report exposed update metadata", async () => {
  const h = makeHarness();
  try {
    const response = await h.request("/api/communications/website/maintenance/updates");
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.readOnly, true);
    assert.equal(data.plugins.status, "updates_available");
    assert.equal(data.plugins.updatesAvailable, 1);
    assert.equal(data.themes.status, "current");
    assert.equal(data.core.status, "not exposed");
    assert.match(data.core.reason, /HTTP 404/);
    assert.deepEqual(h.wordpressMethods, ["GET", "GET", "GET"]);
    assert.equal(h.writes.length, 0);
  } finally { h.restore(); }
});
