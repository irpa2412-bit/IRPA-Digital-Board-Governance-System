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
    calls.push({ host: url.hostname, path: url.pathname, method, headers: new Headers(init.headers) });
    if (url.hostname === "cpanel.test") {
      if (url.pathname.endsWith("/Fileman/list_files")) return response({ status: 1, data: [] });
      if (url.pathname.endsWith("/Fileman/upload_files")) {
        assert.ok(init.body instanceof FormData);
        return response({ status: 1, data: [{ file: "TEST-upload" }] });
      }
      throw new Error("Unexpected cPanel request: " + url.pathname);
    }
    assert.equal(url.hostname, "staging.irpa.or.tz");
    if (url.pathname.startsWith("/wp-json/")) {
      const wpHeaders = new Headers(init.headers);
      assert.equal(wpHeaders.get("User-Agent"), "IRPA-DBGS-Communications-Worker/1.0 (+https://irpa.or.tz)");
      assert.equal(wpHeaders.get("Authorization"), "Basic " + btoa("editor:testpassword"));
      assert.equal(wpHeaders.get("X-IRPA-Staging-Authorization"), "Basic " + btoa("editor:testpassword"));
    }
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
      assert.ok(init.body instanceof Uint8Array, "WordPress receives raw binary, never JSON or base64");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Accept"), "application/json");
      assert.match(headers.get("Content-Disposition") || "", /^attachment; filename="[A-Za-z0-9._-]+"$/);
      const mime = headers.get("Content-Type");
      const bytes = new Uint8Array(init.body);
      if (mime === "image/png") assert.deepEqual([...bytes.slice(0, 8)], [137,80,78,71,13,10,26,10]);
      if (mime === "video/mp4") assert.equal(new TextDecoder().decode(bytes.slice(4, 8)), "ftyp");
      if (mime === "application/pdf") assert.equal(new TextDecoder().decode(bytes.slice(0, 8)), "%PDF-1.4");
      if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") assert.deepEqual([...bytes.slice(0, 2)], [80,75]);
      const id = ++nextMediaId;
      return response({ id, source_url: "https://staging.irpa.or.tz/wp-content/uploads/test-" + id + ".bin" }, 201);
    }
    const mediaMatch = url.pathname.match(/\/wp-json\/wp\/v2\/media\/(\d+)$/);
    if (mediaMatch && method === "POST") { metadataCalls.push({ contentType: new Headers(init.headers).get("Content-Type"), override: new Headers(init.headers).get("X-HTTP-Method-Override") }); return new Response("<html><body>blocked</body></html>", { status: 406, headers: { "Content-Type": "text/html", "CF-Ray": "media406-ray-DAR" } }); }
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
    assert.ok(data.cleanupItems.some(item => item.kind === "TEST draft page" && item.id === 111 && item.url));
    assert.ok(data.cleanupItems.some(item => item.kind === "TEST draft post" && item.id === 112 && item.url));
    assert.equal(data.cleanupItems.filter(item => item.kind === "TEST media").length, 16);
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

test("caption diagnostic is opt-in, uploads one media item, and sends three wire variants", async () => {
  calls.length = 0; nextMediaId = 700;
  const originalFetch = globalThis.fetch;
  const wireBodies = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
    const method = init.method || "GET";
    const headers = new Headers(init.headers);
    calls.push({ host: url.hostname, path: url.pathname, method, headers });
    assert.equal(headers.get("User-Agent"), "IRPA-DBGS-Communications-Worker/1.0 (+https://irpa.or.tz)");
    assert.equal(headers.get("Authorization"), "Basic " + btoa("editor:testpassword"));
    assert.equal(headers.get("X-IRPA-Staging-Authorization"), "Basic " + btoa("editor:testpassword"));
    if (url.pathname.endsWith("/users/me")) return response({ id: 7, roles: ["editor"], capabilities: { upload_files: true } });
    if (url.pathname === "/wp-json/wp/v2/media" && method === "POST") {
      assert.ok(init.body instanceof Uint8Array);
      return response({ id: ++nextMediaId, source_url: "https://staging.irpa.or.tz/wp-content/uploads/diagnostic.png" }, 201);
    }
    const match = url.pathname.match(/\/wp-json\/wp\/v2\/media\/(\d+)$/);
    if (match && method === "POST") {
      const raw = String(init.body);
      wireBodies.push(raw);
      const decoded = JSON.parse(raw);
      if (decoded.caption === "TEST ONLY — retained for acceptance evidence") {
        return new Response("<html><body>blocked by edge</body></html>", { status: 406, headers: { "Content-Type": "text/html; charset=UTF-8", "CF-Ray": "abc123-DAR" } });
      }
      return response({ id: Number(match[1]), caption: { raw: decoded.caption } });
    }
    throw new Error("Unexpected request in diagnostic-only mode: " + method + " " + url.pathname);
  };
  try {
    const router = makeRouter();
    const env = { IRPA_ENVIRONMENT: "staging", IRPA_WORKER_ENVIRONMENT: "staging", WORDPRESS_BASE_URL: "https://staging.irpa.or.tz", WORDPRESS_USERNAME: "editor", WORDPRESS_APPLICATION_PASSWORD: "testpassword" };
    const result = await router(new Request("https://gateway.test/api/communications/website/production-acceptance", {
      method: "POST", headers: { Authorization: "Bearer test", "Content-Type": "application/json" }, body: JSON.stringify({ diagnosticMode: true })
    }), env);
    const data = await result.json();
    assert.equal(result.status, 200);
    assert.equal(data.diagnosticMode, true);
    assert.equal(data.cleanupItems.length, 1);
    assert.equal(data.cleanupItems[0].id, 701);
    assert.equal(calls.filter(call => call.path === "/wp-json/wp/v2/media" && call.method === "POST").length, 1);
    assert.equal(calls.filter(call => /\/media\/701$/.test(call.path) && call.method === "POST").length, 3);
    assert.equal(wireBodies.length, 3);
    assert.equal(wireBodies[0].includes("TEST ONLY - retained for acceptance evidence"), true);
    assert.equal(wireBodies[1].includes("TEST ONLY — retained for acceptance evidence"), true);
    assert.ok(wireBodies[2].includes("\\u2014"), "Case C sends the literal JSON escape on the wire");
    assert.ok(wireBodies[2].includes("\\u2014"), "Case C sends the literal JSON escape on the wire");
    const caseB = data.report.find(row => row.label.includes("B literal em dash"));
    assert.equal(caseB.httpStatus, 406);
    assert.equal(caseB.detail.classification, "likely_server_firewall_rejection");
    assert.equal(caseB.detail.rayId, "abc123-DAR");
    assert.equal("body" in caseB.detail, false, "HTML response body is not returned");
    assert.equal(data.nothingDeleted, true);
    assert.equal(data.nothingPublished, true);
    assert.ok(calls.every(call => call.method !== "DELETE"));
  } finally { globalThis.fetch = originalFetch; }
});

test("production WordPress requests retain Authorization and omit staging-only auth header", async () => {
  const originalFetch = globalThis.fetch;
  let inspected = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
    if (url.hostname === "irpa.or.tz") {
      const headers = new Headers(init.headers);
      assert.equal(headers.get("User-Agent"), "IRPA-DBGS-Communications-Worker/1.0 (+https://irpa.or.tz)");
      assert.equal(headers.get("Authorization"), "Basic " + btoa("editor:testpassword"));
      assert.equal(headers.get("X-IRPA-Staging-Authorization"), null);
      inspected = true;
      if (url.pathname.endsWith("/users/me")) return response({ id: 7, roles: ["editor"], capabilities: { upload_files: false } });
    }
    if (url.hostname === "cpanel.test") return response({ status: 1, data: [] });
    if (url.hostname === "irpa.or.tz") return response({ code: "not_found", message: "not found" }, 404);
    throw new Error("Unexpected production auth test request: " + url.hostname + url.pathname);
  };
  try {
    const router = makeRouter();
    const env = { IRPA_ENVIRONMENT: "production", IRPA_WORKER_ENVIRONMENT: "production", WORDPRESS_BASE_URL: "https://irpa.or.tz", WORDPRESS_USERNAME: "editor", WORDPRESS_APPLICATION_PASSWORD: "testpassword", CPANEL_BASE_URL: "https://cpanel.test:2083", CPANEL_USERNAME: "testcp", CPANEL_API_TOKEN: "test-token", CPANEL_DOCUMENT_ROOT: "public_html" };
    await router(new Request("https://gateway.test/api/communications/website/production-acceptance", {
      method: "POST", headers: { Authorization: "Bearer test", "Content-Type": "application/json" }, body: "{}"
    }), env);
    assert.equal(inspected, true);
  } finally { globalThis.fetch = originalFetch; }
});

test("all metadata fallback variants blocked retain the uploaded media ID and sanitised WAF diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  const metadataCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
    const headers = new Headers(init.headers);
    assert.equal(headers.get("User-Agent"), "IRPA-DBGS-Communications-Worker/1.0 (+https://irpa.or.tz)");
    if (url.pathname.endsWith("/users/me")) return response({ id: 7, roles: ["editor"], capabilities: { upload_files: true } });
    if (url.pathname === "/wp-json/wp/v2/media" && init.method === "POST") {
      if (init.body instanceof FormData) {
        assert.equal(init.body.get("title"), "TEST image");
        assert.equal(init.body.get("alt_text"), "Test image");
        return new Response("<html><body>multipart blocked</body></html>", { status: 406, headers: { "Content-Type": "text/html", "CF-Ray": "multipart-ray-DAR" } });
      }
      assert.ok(init.body instanceof Uint8Array, "binary upload is the first fallback after multipart 406");
      return response({ id: 812, source_url: "https://staging.irpa.or.tz/wp-content/uploads/test-812.png" }, 201);
    }
    if (url.pathname === "/wp-json/wp/v2/media/812" && init.method === "POST") {
      metadataCalls.push({ contentType: headers.get("Content-Type"), override: headers.get("X-HTTP-Method-Override") });
      return new Response("<html><body>blocked</body></html>", { status: 406, headers: { "Content-Type": "text/html", "CF-Ray": "media406-ray-DAR" } });
    }
    throw new Error("Unexpected media metadata failure test request: " + url.pathname);
  };
  try {
    const router = makeRouter();
    const env = { IRPA_ENVIRONMENT: "staging", IRPA_WORKER_ENVIRONMENT: "staging", WORDPRESS_BASE_URL: "https://staging.irpa.or.tz", WORDPRESS_USERNAME: "editor", WORDPRESS_APPLICATION_PASSWORD: "testpassword" };
    const result = await router(new Request("https://gateway.test/api/communications/website/media", {
      method: "POST", headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "test.png", title: "TEST image", contentType: "image/png", altText: "Test image", caption: "TEST ONLY", dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAC0lEQVR4nGNgQAYAAA4AAamRc7EAAAAASUVORK5CYII=", destination: "media-library" })
    }), env);
    const data = await result.json();
    assert.equal(result.status, 502);
    assert.equal(data.code, "wordpress_media_firewall_blocked", JSON.stringify(data));
    assert.equal(data.media.id, 812);
    assert.equal(data.media.url, "https://staging.irpa.or.tz/wp-content/uploads/test-812.png");
    assert.equal(data.media.metadataStatus, "failed");
    assert.equal(data.error, "FAIL: blocked by server firewall; ModSecurity exemption needed for /wp-json/wp/v2/media");
    assert.equal(data.detail.classification, "likely_server_firewall_rejection");
    assert.equal(data.detail.rayId, "media406-ray-DAR");
    assert.equal(data.detail.request.method, "POST");
    assert.equal(data.detail.request.path, "/wp-json/wp/v2/media/812");
    assert.equal(data.detail.request.contentType, "application/json");
    assert.equal(data.detail.request.accept, "application/json");
    assert.deepEqual(data.detail.request.bodyFields, ["alt_text", "title"]);
    assert.equal(metadataCalls.length, 3);
    assert.equal(metadataCalls[0].contentType, "application/x-www-form-urlencoded");
    assert.equal(metadataCalls[1].override, "PUT");
    assert.equal(metadataCalls[2].contentType, "application/json");
    assert.equal("body" in data.detail, false);
  } finally { globalThis.fetch = originalFetch; }
});
