import test from "node:test";
import assert from "node:assert/strict";
import { createCommunicationsSiteRouter } from "../src/communicationsSite.mjs";

const calls = [];
let nextMediaId = 500;
function response(data, status = 200, headers = { "Content-Type": "application/json" }) {
  return new Response(data instanceof Uint8Array ? data : JSON.stringify(data), { status, headers });
}
function makeRouter() {
  return createCommunicationsSiteRouter({
    authenticateFirebaseRequest: async () => ({ user_id: "acceptance-admin", email: "admin@example.test", token: "fake-token", role: "Executive Director" }),
    getFirestoreDocument: async () => ({ active: false }),
    getInstitutionalProfileForUser: async () => ({ memberRecord: { role: "Executive Director", status: "Active" }, employeeRecord: null }),
    firestoreDocumentToPlain: value => value,
    commitDocumentAndAudit: async () => {},
    json: (data, status = 200, headers = {}) => response(data, status, { "Content-Type": "application/json", ...headers }),
    corsHeaders: () => ({})
  });
}
test("production acceptance runs TEST-only draft lifecycle and uploads without publishing or deleting", async () => {
  calls.length = 0; nextMediaId = 500;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
    const method = init.method || "GET";
    calls.push({ host: url.hostname, path: url.pathname, method });
    if (url.hostname === "cpanel.test") {
      if (url.pathname.endsWith("/Fileman/list_files")) return response({ status: 1, data: [] });
      if (url.pathname.endsWith("/Fileman/upload_files")) {
        assert.ok(init.body instanceof FormData);
        return response({ status: 1, data: [{ file: "TEST-upload" }] });
      }
      throw new Error("Unexpected cPanel request: " + url.pathname);
    }
    assert.equal(url.hostname, "staging.irpa.or.tz");
    if (url.pathname.endsWith("/wp-json/wp/v2/users/me")) return response({ id: 7, roles: ["editor"], capabilities: { upload_files: true } });
    if (url.pathname === "/wp-json/wp/v2/pages" && method === "POST") {
      const body = JSON.parse(init.body); assert.equal(body.status, "draft"); assert.match(body.title, /^TEST/);
      return response({ id: 111, status: "draft", link: "https://staging.irpa.or.tz/test-page/" }, 201);
    }
    if (url.pathname === "/wp-json/wp/v2/posts" && method === "POST") {
      const body = JSON.parse(init.body); assert.equal(body.status, "draft"); assert.match(body.title, /^TEST/);
      return response({ id: 112, status: "draft", link: "https://staging.irpa.or.tz/test-post/" }, 201);
    }
    if (url.pathname === "/wp-json/wp/v2/pages/111" && method === "POST") {
      const body = JSON.parse(init.body); if (body.title) assert.match(body.title, /EDITED TEST/); if (body.status) assert.equal(body.status, "draft");
      return response({ id: 111, status: "draft" });
    }
    if (url.pathname === "/wp-json/wp/v2/posts/112" && method === "POST") {
      const body = JSON.parse(init.body); assert.equal(body.status, "draft"); assert.match(body.title, /EDITED TEST/);
      return response({ id: 112, status: "draft" });
    }
    if (url.pathname.endsWith("/revisions")) return response([{ id: 900 }]);
    if (url.pathname === "/wp-json/wp/v2/media" && method === "POST") {
      assert.ok(init.body instanceof Uint8Array);
      const id = ++nextMediaId;
      return response({ id, source_url: "https://staging.irpa.or.tz/wp-content/uploads/test-" + id + ".bin" }, 201);
    }
    const mediaMatch = url.pathname.match(/\/wp-json\/wp\/v2\/media\/(\d+)$/);
    if (mediaMatch && method === "POST") return response({ id: Number(mediaMatch[1]) });
    if (url.pathname === "/wp-json/wp/v2/pages/111" && method === "POST") return response({ id: 111, status: "draft" });
    if (url.pathname.startsWith("/wp-content/uploads/") && method === "GET") return response(new Uint8Array([1, 2, 3]), 200, { "Content-Type": "application/octet-stream" });
    throw new Error("Unexpected WordPress request: " + method + " " + url.pathname);
  };
  try {
    const router = makeRouter();
    const env = {
      IRPA_ENVIRONMENT: "staging", IRPA_WORKER_ENVIRONMENT: "staging",
      WORDPRESS_BASE_URL: "https://staging.irpa.or.tz", WORDPRESS_USERNAME: "editor", WORDPRESS_APPLICATION_PASSWORD: "testpassword",
      CPANEL_BASE_URL: "https://cpanel.test:2083", CPANEL_USERNAME: "testcp", CPANEL_API_TOKEN: "test-token",
      CPANEL_DOCUMENT_ROOT: "public_html/staging"
    };
    const result = await router(new Request("https://gateway.test/api/communications/website/production-acceptance", {
      method: "POST", headers: { Authorization: "Bearer test", "Content-Type": "application/json" }, body: "{}"
    }), env);
    const data = await result.json();
    assert.equal(result.status, 200);
    assert.equal(data.testRun, true);
    assert.equal(data.nothingPublished, true);
    assert.equal(data.nothingDeleted, true);
    assert.equal(data.uploadsRetained, true);
    assert.equal(data.createdDrafts.pageId, 111);
    assert.equal(data.createdDrafts.postId, 112);
    assert.equal(data.failCount, 0, JSON.stringify(data.report.filter(row => row.status !== "PASS")));
    assert.equal(data.report.filter(row => row.label.includes("URL open")).length, 16);
    assert.equal(data.report.filter(row => row.status === "PASS").length, data.report.length);
    assert.ok(calls.every(call => !/DELETE/i.test(call.method)));
    assert.ok(calls.filter(call => call.path === "/wp-json/wp/v2/pages" || call.path === "/wp-json/wp/v2/posts").every(call => call.method === "POST"));
  } finally { globalThis.fetch = originalFetch; }
});
test("production acceptance blocks media tests if upload_files is absent", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof URL ? input.href : String(input));
    if (url.pathname.endsWith("/users/me")) return response({ id: 7, roles: ["editor"], capabilities: { upload_files: false } });
    if (url.hostname === "cpanel.test") return response({ status: 1, data: [] });
    throw new Error("No media upload should occur when upload_files is missing.");
  };
  try {
    const router = makeRouter();
    const env = {
      IRPA_ENVIRONMENT: "staging", IRPA_WORKER_ENVIRONMENT: "staging",
      WORDPRESS_BASE_URL: "https://staging.irpa.or.tz", WORDPRESS_USERNAME: "editor", WORDPRESS_APPLICATION_PASSWORD: "testpassword",
      CPANEL_BASE_URL: "https://cpanel.test:2083", CPANEL_USERNAME: "testcp", CPANEL_API_TOKEN: "test-token",
      CPANEL_DOCUMENT_ROOT: "public_html/staging"
    };
    const result = await router(new Request("https://gateway.test/api/communications/website/production-acceptance", {
      method: "POST", headers: { Authorization: "Bearer test", "Content-Type": "application/json" }, body: "{}"
    }), env);
    const data = await result.json();
    assert.equal(result.status, 200);
    assert.ok(data.report.some(row => row.label.includes("upload_files capability") && row.status === "FAIL"));
    assert.ok(data.report.filter(row => row.label.includes("upload to WordPress")).every(row => row.status === "FAIL"));
  } finally { globalThis.fetch = originalFetch; }
});
