import test from "node:test";
import assert from "node:assert/strict";
import { createCommunicationsSiteRouter } from "../src/communicationsSite.mjs";

const created = [];
const existingPages = new Set(["about-irpa"]);
const existingTerms = new Set(["categories:news", "tags:irpa"]);
function response(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
function makeRouter() {
  return createCommunicationsSiteRouter({
    authenticateFirebaseRequest: async () => ({ user_id: "structure-test", email: "test@example.test", token: "fake-token", role: "Communications Officer" }),
    getFirestoreDocument: async () => ({ active: false }),
    getInstitutionalProfileForUser: async () => ({ memberRecord: { role: "Communications Officer", status: "Active" }, employeeRecord: null }),
    firestoreDocumentToPlain: value => value,
    commitDocumentAndAudit: async () => {},
    json: (data, status = 200, headers = {}) => response(data, status),
    corsHeaders: () => ({})
  });
}
test("site structure creator creates only missing draft pages, terms and a separate draft navigation record", async () => {
  created.length = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof URL ? input.href : String(input));
    const method = init.method || "GET";
    assert.equal(url.hostname, "staging.irpa.or.tz");
    assert.equal(new Headers(init.headers).get("authorization"), "Basic " + btoa("editor:testpassword"));
    if (url.pathname.endsWith("/users/me")) return response({ id: 5, roles: ["editor"], capabilities: { edit_posts: true, edit_pages: true, upload_files: true } });
    const match = url.pathname.match(/\/wp-json\/wp\/v2\/(pages|categories|tags|navigation)(?:\/(\d+))?$/);
    if (!match) throw new Error("Unexpected WordPress request " + url.pathname);
    const type = match[1];
    if (method === "GET") {
      const slug = url.searchParams.get("slug");
      const exists = type === "pages" ? existingPages.has(slug) : type === "navigation" ? false : existingTerms.has(type + ":" + slug);
      return response(exists ? [{ id: 90, slug, status: "draft" }] : []);
    }
    if (method === "POST") {
      const payload = JSON.parse(init.body);
      created.push({ type, payload });
      const item = { id: 100 + created.length, ...payload, link: "https://staging.irpa.or.tz/" + (payload.slug || "draft") + "/", status: payload.status || "draft" };
      return response(item, 201);
    }
    throw new Error("Unexpected method " + method);
  };
  try {
    const router = makeRouter();
    const env = { IRPA_ENVIRONMENT: "staging", IRPA_WORKER_ENVIRONMENT: "staging", WORDPRESS_BASE_URL: "https://staging.irpa.or.tz", WORDPRESS_USERNAME: "editor", WORDPRESS_APPLICATION_PASSWORD: "testpassword" };
    const responseResult = await router(new Request("https://gateway.test/api/communications/website/structure", { method: "POST", headers: { Authorization: "Bearer test", "Content-Type": "application/json" }, body: "{}" }), env);
    const data = await responseResult.json();
    assert.equal(responseResult.status, 200);
    assert.equal(data.draftOnly, true);
    assert.equal(data.liveMenuChanged, false);
    assert.equal(data.result.pages.find(page => page.slug === "about-irpa").status, "SKIPPED_EXISTS");
    assert.equal(data.result.pages.filter(page => page.status === "CREATED_DRAFT").length, 9);
    assert.ok(created.every(row => row.payload.status === "draft" || row.type === "categories" || row.type === "tags"));
    assert.ok(created.some(row => row.type === "navigation" && row.payload.status === "draft"));
    assert.ok(created.every(row => !["publish", "future", "private"].includes(row.payload.status)));
  } finally { globalThis.fetch = originalFetch; }
});
test("site structure creator never attempts to change live menus when navigation REST is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof URL ? input.href : String(input));
    if (url.pathname.endsWith("/users/me")) return response({ id: 5, roles: ["editor"], capabilities: { upload_files: true } });
    if (url.pathname.endsWith("/navigation")) return response({ code: "rest_no_route" }, 404);
    const match = url.pathname.match(/\/wp-json\/wp\/v2\/(pages|categories|tags)$/);
    if (!match) throw new Error("Unexpected request " + url.pathname);
    if (init.method === "POST") return response({ id: 1, status: "draft", link: "https://staging.irpa.or.tz/test/" }, 201);
    return response([]);
  };
  try {
    const router = makeRouter();
    const env = { IRPA_ENVIRONMENT: "staging", IRPA_WORKER_ENVIRONMENT: "staging", WORDPRESS_BASE_URL: "https://staging.irpa.or.tz", WORDPRESS_USERNAME: "editor", WORDPRESS_APPLICATION_PASSWORD: "testpassword" };
    const res = await router(new Request("https://gateway.test/api/communications/website/structure", { method: "POST", headers: { Authorization: "Bearer test", "Content-Type": "application/json" }, body: "{}" }), env);
    const data = await res.json();
    assert.equal(data.liveMenuChanged, false);
    assert.equal(data.result.menu.status, "UNAVAILABLE");
  } finally { globalThis.fetch = originalFetch; }
});
