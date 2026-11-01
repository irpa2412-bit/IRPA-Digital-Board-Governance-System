import test from "node:test";
import assert from "node:assert/strict";
import { createCommunicationsSiteRouter } from "../src/communicationsSite.mjs";

const TEST_PASSWORD = "test-only-password-not-a-real-secret";
let state;
let nativeRevisions;
let nextRevisionId;
let kvStore;
let auditEvents;
let requestCount;
let wpRoles;
let wpItemLink;
let lastMediaUpload;
let createdPost;
let postCreateCount;
let consoleMessages;
let originalFetch;
let originalConsole;

function currentItem() {
  return {
    id: 123,
    title: { raw: state.title, rendered: state.title },
    content: { raw: state.content, rendered: state.content },
    excerpt: { raw: state.excerpt, rendered: state.excerpt },
    featured_media: state.featured_media,
    status: state.status,
    link: wpItemLink,
    modified: state.modified
  };
}
function revisionFrom(snapshot, id) {
  return {
    id,
    date: snapshot.modified,
    modified: snapshot.modified,
    title: { raw: snapshot.title, rendered: snapshot.title },
    content: { raw: snapshot.content, rendered: snapshot.content },
    excerpt: { raw: snapshot.excerpt, rendered: snapshot.excerpt },
    featured_media: snapshot.featured_media,
    status: snapshot.status
  };
}
function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
function makeKV() {
  return {
    async put(key, value) { kvStore.set(key, String(value)); },
    async get(key) { return kvStore.get(key) ?? null; },
    async list({ prefix, limit = 1000 }) {
      return {
        keys: [...kvStore.keys()].filter(key => key.startsWith(prefix)).slice(0, limit).map(name => ({ name }))
      };
    }
  };
}
function makeRouter(role = "Communications Officer") {
  const deps = {
    authenticateFirebaseRequest: async request => ({
      user_id: "test-user-123",
      email: "editor@example.test",
      token: "fake-firebase-token",
      role: request.headers.get("x-test-role") || role
    }),
    getFirestoreDocument: async (_env, path) => path.startsWith("adminProfiles/") ? { active: false } : null,
    getInstitutionalProfileForUser: async (_env, claims) => ({
      memberRecord: { role: claims.role, status: "Active" },
      employeeRecord: null
    }),
    firestoreDocumentToPlain: value => value,
    commitDocumentAndAudit: async (_env, path, _token, recordFields, _mask, auditFields) => {
      auditEvents.push({ path, recordFields, auditFields });
    },
    json: (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...headers }
    }),
    corsHeaders: () => ({})
  };
  return createCommunicationsSiteRouter(deps);
}
function makeEnv(overrides = {}) {
  return {
    IRPA_ENVIRONMENT: "staging",
    WORDPRESS_BASE_URL: "https://staging.irpa.or.tz",
    WORDPRESS_USERNAME: "integration-editor",
    WORDPRESS_APPLICATION_PASSWORD: TEST_PASSWORD,
    DRIVE_KV: makeKV(),
    ...overrides
  };
}
async function call(router, env, path, { method = "GET", body, role } = {}) {
  const headers = { Authorization: "Bearer fake-user-token", Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (role) headers["x-test-role"] = role;
  return router(new Request("https://gateway.test" + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
}

test.beforeEach(() => {
  state = {
    title: "Original test page",
    content: "<p>Original exact content.</p>",
    excerpt: "Original excerpt",
    featured_media: 19,
    status: "publish",
    modified: "2026-10-17T08:00:00"
  };
  nativeRevisions = [revisionFrom({ ...state }, 44)];
  nextRevisionId = 45;
  kvStore = new Map();
  auditEvents = [];
  requestCount = 0;
  wpRoles = ["editor"];
  wpItemLink = "https://staging.irpa.or.tz/test-page/";
  lastMediaUpload = null;
  createdPost = null;
  postCreateCount = 0;
  consoleMessages = [];
  originalFetch = globalThis.fetch;
  originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  console.log = (...args) => consoleMessages.push(["log", ...args]);
  console.info = (...args) => consoleMessages.push(["info", ...args]);
  console.warn = (...args) => consoleMessages.push(["warn", ...args]);
  console.error = (...args) => consoleMessages.push(["error", ...args]);
  globalThis.fetch = async (input, init = {}) => {
    requestCount++;
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = init.method || "GET";
    if (url.hostname !== "staging.irpa.or.tz") throw new Error("Test blocked non-staging host.");
    if (url.pathname === "/wp-json/wp/v2/media" && method === "POST") {
      lastMediaUpload = { contentType: new Headers(init.headers).get("Content-Type"), disposition: new Headers(init.headers).get("Content-Disposition"), bytes: new Uint8Array(init.body) };
      return response({ id: 88, source_url: "https://staging.irpa.or.tz/wp-content/uploads/field.jpg", title: { raw: "field.jpg" }, alt_text: "" }, 201);
    }
    if (url.pathname === "/wp-json/wp/v2/media/88" && method === "POST") {
      const metadata = JSON.parse(init.body || "{}");
      return response({ id: 88, source_url: "https://staging.irpa.or.tz/wp-content/uploads/field.jpg", title: { raw: "field.jpg" }, alt_text: metadata.alt_text, caption: { raw: metadata.caption } });
    }
    if (url.pathname === "/wp-json/wp/v2/categories") return response([{ id: 3, name: "News" }]);
    if (url.pathname === "/wp-json/wp/v2/tags") return response([{ id: 9, name: "Rangelands" }]);
    if (url.pathname === "/wp-json/wp/v2/posts" && method === "OPTIONS") return response({ schema: { properties: { meta: { properties: {} } } } });
    if (url.pathname === "/wp-json/wp/v2/posts" && method === "POST") {
      postCreateCount++;
      createdPost = JSON.parse(init.body || "{}");
      return response({ id: 321, title: { raw: createdPost.title }, content: { raw: createdPost.content }, excerpt: { raw: createdPost.excerpt }, featured_media: createdPost.featured_media, status: createdPost.status, link: "https://staging.irpa.or.tz/new-update/" }, 201);
    }
    if (url.pathname === "/wp-json/wp/v2/posts/321" && method === "GET") {
      return response({ id: 321, title: { raw: createdPost.title }, content: { raw: createdPost.content }, excerpt: { raw: createdPost.excerpt }, featured_media: createdPost.featured_media, status: createdPost.status, link: "https://staging.irpa.or.tz/new-update/" });
    }
    if (url.pathname === "/wp-json/wp/v2/users/me") {
      return response({ id: 7, name: "Staging Editor", roles: wpRoles, capabilities: { edit_posts: true, edit_pages: true } });
    }
    if (url.pathname === "/wp-json/wp/v2/pages") {
      return response([currentItem()]);
    }
    if (url.pathname === "/wp-json/wp/v2/pages/123/revisions") {
      return response(nativeRevisions);
    }
    const revisionMatch = /^\/wp-json\/wp\/v2\/pages\/123\/revisions\/(\d+)$/.exec(url.pathname);
    if (revisionMatch) {
      const revision = nativeRevisions.find(item => item.id === Number(revisionMatch[1]));
      return revision ? response(revision) : response({ code: "rest_revision_invalid_id" }, 404);
    }
    if (url.pathname === "/wp-json/wp/v2/pages/123" && method === "GET") return response(currentItem());
    if (url.pathname === "/wp-json/wp/v2/pages/123" && method === "POST") {
      const before = { ...state };
      const payload = JSON.parse(init.body || "{}");
      state = {
        title: String(payload.title),
        content: String(payload.content),
        excerpt: String(payload.excerpt),
        featured_media: Number(payload.featured_media || 0),
        status: String(payload.status),
        modified: new Date(Date.now() + nextRevisionId * 1000).toISOString()
      };
      nativeRevisions.unshift(revisionFrom(before, nextRevisionId++));
      return response(currentItem());
    }
    return response({ code: "rest_no_route" }, 404);
  };
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
});

test("staging users/me connection check returns HTTP 200 without exposing credentials", async () => {
  const router = makeRouter();
  const result = await call(router, makeEnv(), "/api/communications/site/status");
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.connections.website, "connected");
  assert.equal(data.connections.websiteHttpStatus, 200);
  assert.equal(data.connections.websiteAccount.canEditPosts, true);
  assert.equal(JSON.stringify(data).includes(TEST_PASSWORD), false);
});

test("one staging page can be read with editable fields", async () => {
  const router = makeRouter();
  const result = await call(router, makeEnv(), "/api/communications/website/content/pages/123");
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.item.id, 123);
  assert.equal(data.item.title, "Original test page");
  assert.equal(data.item.content, "<p>Original exact content.</p>");
  assert.equal(data.item.featuredMedia, 19);
  const listed = await call(router, makeEnv(), "/api/communications/website/content?type=pages");
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).items[0].id, 123);
});

test("an edit saves a snapshot and one-click restore returns all allowed fields exactly", async () => {
  const router = makeRouter();
  const env = makeEnv();
  const original = { ...state };
  const edit = await call(router, env, "/api/communications/website/content", {
    method: "PUT",
    body: {
      type: "pages", id: 123, title: "Updated staging title",
      content: "<p>Updated staging body.</p>", excerpt: "Updated excerpt",
      featuredMedia: 77, status: "draft"
    }
  });
  assert.equal(edit.status, 200);
  const editData = await edit.json();
  assert.ok(editData.snapshotId);
  assert.equal(editData.item.title, "Updated staging title");
  assert.equal(editData.item.status, "draft");
  assert.equal(editData.item.featuredMedia, 77);
  assert.equal(editData.previousRevisionId, 44);
  const revisionsResponse = await call(router, env, "/api/communications/website/revisions?type=pages&id=123");
  assert.equal(revisionsResponse.status, 200);
  const revisionList = await revisionsResponse.json();
  assert.ok(revisionList.revisions.some(item => item.snapshotId === editData.snapshotId));
  assert.ok(revisionList.revisions.some(item => item.revisionId === 44));

  const restored = await call(router, env, "/api/communications/website/restore", {
    method: "POST",
    body: { type: "pages", id: 123, snapshotId: editData.snapshotId }
  });
  assert.equal(restored.status, 200);
  const restoreData = await restored.json();
  assert.ok(restoreData.safetySnapshotId);
  assert.equal(restoreData.item.title, original.title);
  assert.equal(restoreData.item.content, original.content);
  assert.equal(restoreData.item.excerpt, original.excerpt);
  assert.equal(restoreData.item.featuredMedia, original.featured_media);
  assert.equal(restoreData.item.status, original.status);
  assert.deepEqual({ title: state.title, content: state.content, excerpt: state.excerpt, featured_media: state.featured_media, status: state.status }, {
    title: original.title, content: original.content, excerpt: original.excerpt, featured_media: original.featured_media, status: original.status
  });
  assert.ok(auditEvents.some(event => JSON.stringify(event).includes("COMMUNICATION_WEBSITE_EDIT_SNAPSHOT_SAVED")));
  assert.ok(auditEvents.some(event => JSON.stringify(event).includes("COMMUNICATION_WEBSITE_REVISION_RESTORED")));
});

test("the registered Communication & Media authority can access the website connection check", async () => {
  const router = makeRouter();
  const result = await call(router, makeEnv(), "/api/communications/site/status", { role: "Communication & Media" });
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.connections.website, "connected");
});

test("a user without a Communication & Media role or active admin profile is refused", async () => {
  const router = makeRouter();
  const result = await call(router, makeEnv(), "/api/communications/website/content?type=pages", { role: "Finance Officer" });
  assert.equal(result.status, 403);
});

test("production hostname with a staging path is rejected before any WordPress request", async () => {
  const router = makeRouter();
  const before = requestCount;
  const result = await call(router, makeEnv({ WORDPRESS_BASE_URL: "https://irpa.or.tz/staging" }), "/api/communications/website/content/pages/123");
  assert.equal(result.status, 502);
  assert.equal(requestCount, before);
});

test("cPanel Fileman reads use the relative path for the exact staging document root", async () => {
  const router = makeRouter();
  const env = makeEnv({
    CPANEL_BASE_URL: "https://cpanel.example.test:2083/",
    CPANEL_USERNAME: "irpaortz",
    CPANEL_API_TOKEN: "test-only-cpanel-token",
    CPANEL_DOCUMENT_ROOT: "/home/irpaortz/public_html/staging"
  });
  let requestedUrl;
  globalThis.fetch = async input => {
    requestedUrl = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
    assert.equal(requestedUrl.hostname, "cpanel.example.test");
    return response({ status: 1, data: { data: { content: "staging-only content" } } });
  };
  const result = await call(router, env, "/api/communications/cpanel/files?path=probe.txt", { role: "Executive Director" });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).content, "staging-only content");
  assert.equal(requestedUrl.pathname, "/execute/Fileman/get_file_content");
  assert.equal(requestedUrl.searchParams.get("dir"), "public_html/staging");
  assert.equal(requestedUrl.searchParams.get("file"), "probe.txt");
});

test("cPanel file access refuses any document root other than the exact staging directory", async () => {
  const router = makeRouter();
  const env = makeEnv({
    CPANEL_BASE_URL: "https://cpanel.example.test:2083/",
    CPANEL_USERNAME: "irpaortz",
    CPANEL_API_TOKEN: "test-only-cpanel-token",
    CPANEL_DOCUMENT_ROOT: "/home/irpaortz/public_html"
  });
  let cpanelRequests = 0;
  globalThis.fetch = async () => {
    cpanelRequests++;
    return response({ status: 1, data: { data: { content: "must not be read" } } });
  };
  const result = await call(router, env, "/api/communications/cpanel/files?path=probe.txt", { role: "Executive Director" });
  assert.equal(result.status, 502);
  assert.equal(cpanelRequests, 0);
});

test("audit records and application logs never contain the Worker credential", async () => {
  const router = makeRouter();
  const env = makeEnv();
  const result = await call(router, env, "/api/communications/website/content", {
    method: "PUT",
    body: { type: "pages", id: 123, title: "Safe title", content: "<p>Safe body</p>", excerpt: "", featuredMedia: 0, status: "draft" }
  });
  assert.equal(result.status, 200);
  const auditText = JSON.stringify(auditEvents);
  assert.equal(auditText.includes(TEST_PASSWORD), false);
  assert.equal(auditText.includes("Authorization"), false);
  assert.equal(JSON.stringify(consoleMessages).includes(TEST_PASSWORD), false);
});

test("editing is refused when WordPress has no current revision ID", async () => {
  nativeRevisions = [];
  const router = makeRouter();
  const env = makeEnv();
  const result = await call(router, env, "/api/communications/website/content", {
    method: "PUT",
    body: { type: "pages", id: 123, title: "Should not save", content: "<p>Should not save</p>", excerpt: "", featuredMedia: 0, status: "draft" }
  });
  assert.equal(result.status, 502);
  assert.equal(state.title, "Original test page");
  assert.equal(auditEvents.length, 0);
  assert.equal(kvStore.size, 0);
});

test("the page editor rejects plugins, themes, users, settings and other non-content fields", async () => {
  const router = makeRouter();
  const env = makeEnv();
  const result = await call(router, env, "/api/communications/website/content", {
    method: "PUT",
    body: { type: "pages", id: 123, title: "Blocked", content: "<p>Blocked</p>", excerpt: "", featuredMedia: 0, status: "draft", plugins: ["example"] }
  });
  assert.equal(result.status, 400);
  assert.equal(state.title, "Original test page");
  assert.equal(auditEvents.length, 0);
});

test("WordPress items that advertise a production-host link are refused", async () => {
  wpItemLink = "https://irpa.or.tz/staging/test-page/";
  const router = makeRouter();
  const env = makeEnv();
  const result = await call(router, env, "/api/communications/website/content", {
    method: "PUT",
    body: { type: "pages", id: 123, title: "Blocked", content: "<p>Blocked</p>", excerpt: "", featuredMedia: 0, status: "draft" }
  });
  assert.equal(result.status, 502);
  assert.equal(state.title, "Original test page");
  assert.equal(kvStore.size, 0);
});

test("WordPress Administrator credentials are rejected even when authentication returns HTTP 200", async () => {
  wpRoles = ["administrator"];
  const router = makeRouter();
  const result = await call(router, makeEnv(), "/api/communications/website/content/pages/123");
  assert.equal(result.status, 502);
  assert.equal(requestCount, 1);
});

test("authenticated staging image upload accepts safe image types and records an audit event", async () => {
  const router = makeRouter();
  const result = await call(router, makeEnv(), "/api/communications/website/media", {
    method: "POST",
    body: { filename: "field.jpg", contentType: "image/jpeg", dataBase64: "/9j/4QAHRXhpZgD/2Q==", altText: "Pastoralist meeting", caption: "Community consultation" }
  });
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.media.id, 88);
  assert.equal(data.media.url, "https://staging.irpa.or.tz/wp-content/uploads/field.jpg");
  assert.equal(data.media.caption, "Community consultation", "WordPress caption metadata must be verified and returned");
  assert.equal(lastMediaUpload.contentType, "image/jpeg");
  assert.match(lastMediaUpload.disposition, /field.jpg/);
  assert.deepEqual([...lastMediaUpload.bytes], [0xff, 0xd8, 0xff, 0xd9], "JPEG EXIF APP1 metadata must be stripped before upload");
  assert.ok(auditEvents.some(event => event.auditFields?.action?.stringValue === "COMMUNICATION_WEBSITE_IMAGE_UPLOADED"));
});

test("image upload requires non-empty alt text", async () => {
  const router = makeRouter();
  const result = await call(router, makeEnv(), "/api/communications/website/media", {
    method: "POST", body: { filename: "field.jpg", contentType: "image/jpeg", dataBase64: "/9j/2Q==" }
  });
  assert.equal(result.status, 400);
  assert.equal(lastMediaUpload, null);
});

test("image upload rejects unsupported formats and oversized payloads before WordPress writes", async () => {
  const router = makeRouter();
  const unsupported = await call(router, makeEnv(), "/api/communications/website/media", {
    method: "POST", body: { filename: "script.svg", contentType: "image/svg+xml", dataBase64: "PHN2Zz4=" }
  });
  assert.equal(unsupported.status, 400);
  const oversized = await call(router, makeEnv(), "/api/communications/website/media", {
    method: "POST", body: { filename: "large.png", contentType: "image/png", dataBase64: "A".repeat(8 * 1024 * 1024), altText: "Large image" }
  });
  assert.equal(oversized.status, 413);
});


test("new website updates are created as draft posts with selected taxonomy and media", async () => {
  const router = makeRouter();
  const result = await call(router, makeEnv(), "/api/communications/website/posts", {
    method: "POST",
    body: { title: "Pastoralist update", content: "<h2>Community action</h2><p>Update text.</p>", excerpt: "A short update", categories: [3], tags: [9], featuredMedia: 88, slug: "irpa-test-editorial-en" }
  });
  assert.equal(result.status, 201);
  const data = await result.json();
  assert.equal(data.item.id, 321);
  assert.equal(data.item.status, "draft");
  assert.equal(createdPost.status, "draft");
  assert.deepEqual(createdPost.categories, [3]);
  assert.deepEqual(createdPost.tags, [9]);
  assert.equal(createdPost.slug, "irpa-test-editorial-en");
  assert.equal(postCreateCount, 1);
  assert.ok(auditEvents.some(event => event.auditFields?.action?.stringValue === "COMMUNICATION_WEBSITE_POST_DRAFT_CREATED"));
});

test("Yoast REST capability check reports fields unavailable when WordPress does not expose writable meta", async () => {
  const router = makeRouter();
  const result = await call(router, makeEnv(), "/api/communications/website/seo-capabilities");
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.source, "WordPress REST OPTIONS schema");
  assert.equal(data.verified, true);
  assert.deepEqual(data.yoast, { metaDescription: false, focusKeyphrase: false });
  assert.equal(data.writable, false);
});

test("new post creation refuses Yoast metadata when WordPress REST does not expose the fields", async () => {
  const router = makeRouter();
  const result = await call(router, makeEnv(), "/api/communications/website/posts", {
    method: "POST",
    body: { title: "SEO test", content: "<p>Draft body</p>", slug: "seo-test", seoMetaDescription: "Description" }
  });
  assert.equal(result.status, 422);
  assert.match((await result.json()).error, /not confirmed as writable/);
  assert.equal(postCreateCount, 0);
});

test("new website update API rejects a caller-supplied published status", async () => {
  const router = makeRouter();
  const result = await call(router, makeEnv(), "/api/communications/website/posts", {
    method: "POST",
    body: { title: "Must remain draft", content: "<p>Body</p>", categories: [], tags: [], featuredMedia: 0, slug: "irpa-status-test-en", status: "publish" }
  });
  assert.equal(result.status, 400);
  assert.equal(postCreateCount, 0);
});

test("image upload rejects MIME spoofing before any WordPress media write", async () => {
  const router = makeRouter();
  const result = await call(router, makeEnv(), "/api/communications/website/media", {
    method: "POST",
    body: { filename: "spoofed.jpg", contentType: "image/jpeg", dataBase64: "PHN2Zz48L3N2Zz4=", altText: "Not an image" }
  });
  assert.equal(result.status, 415);
  assert.equal(lastMediaUpload, null);
});

test("production website editor still rejects direct publishing through the existing approval gate", async () => {
  const router = makeRouter();
  const result = await call(router, makeEnv({ IRPA_ENVIRONMENT: "production", WORDPRESS_BASE_URL: "https://irpa.or.tz" }), "/api/communications/website/content", {
    method: "PUT",
    body: { type: "posts", id: 123, title: "Direct publish blocked", content: "<p>Body</p>", excerpt: "", featuredMedia: 0, status: "publish" }
  });
  assert.equal(result.status, 403);
  assert.equal(state.title, "Original test page");
  assert.equal(kvStore.size, 0);
});
