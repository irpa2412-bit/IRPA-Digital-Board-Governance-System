import test from "node:test";
import assert from "node:assert/strict";
import { createMetaOAuthRouter, publishMetaContent, REQUIRED_SCOPES } from "../src/metaOAuth.mjs";

const GATEWAY = "https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev";
const REDIRECT = GATEWAY + "/api/communications/meta/callback";
const ENCRYPTION_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

function makeKv() {
  const values = new Map();
  return {
    values,
    async get(key) { return values.get(key) ?? null; },
    async put(key, value, options) { values.set(key, String(value)); if (options) values.set(key + ":ttl", options.expirationTtl); },
    async delete(key) { values.delete(key); }
  };
}
function harness({ role = "Communications Officer", envOverrides = {} } = {}) {
  const kv = makeKv();
  const env = {
    IRPA_ENVIRONMENT: "staging", FIREBASE_PROJECT_ID: "irpa-dbg-staging-a73ec", IRPA_PRODUCTION_CUTOVER: "false",
    META_APP_ID: "12345678901234", META_APP_SECRET: "test-only-not-a-real-secret", META_TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY, META_STAGING_ALLOWED_PAGE_IDS: "123456789012345", META_STAGING_ALLOWED_INSTAGRAM_IDS: "123456789012346",
    META_REDIRECT_URI: REDIRECT, META_GRAPH_API_VERSION: "v26.0", DRIVE_KV: kv, ...envOverrides
  };
  const router = createMetaOAuthRouter({
    authenticateFirebaseRequest: async () => ({ user_id: "user-1", email: "tester@example.invalid", token: "firebase-test-token" }),
    getFirestoreDocument: async () => null,
    getInstitutionalProfileForUser: async () => ({ memberRecord: { fields: { status: { stringValue: "Active" }, role: { stringValue: role } } } }),
    firestoreDocumentToPlain: doc => doc?.fields ? Object.fromEntries(Object.entries(doc.fields).map(([k,v]) => [k,v.stringValue??v.booleanValue??null])) : doc,
    json: (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } }),
    corsHeaders: () => ({ "Access-Control-Allow-Origin": GATEWAY })
  });
  return { router, env, kv };
}
function mockMetaFetch({ missingScopes = false } = {}) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth/access_token")) {
      const body = new URLSearchParams(String(init.body || ""));
      if (body.has("code")) return Response.json({ access_token: "short-token-fixture", expires_in: 3600 });
      if (body.get("grant_type") === "fb_exchange_token") return Response.json({ access_token: "long-token-fixture", expires_in: 5184000 });
    }
    if (url.pathname.endsWith("/me/permissions")) return Response.json({ data: (missingScopes ? REQUIRED_SCOPES.slice(0, 1) : REQUIRED_SCOPES).map(permission => ({ permission, status: "granted" })) });
    if (url.pathname.endsWith("/me/accounts")) return Response.json({ data: [{
      id: "123456789012345", name: "IRPA Test Page", access_token: "page-token-fixture", tasks: ["CREATE_CONTENT"],
      instagram_business_account: { id: "123456789012346", username: "irpa_test", account_type: "BUSINESS" }
    }] });
    if (url.pathname.endsWith("/me")) return Response.json({ id: "meta-user-1", name: "IRPA Test User" });
    if (url.pathname.endsWith("/123456789012345/feed")) return Response.json({ id: "123456789012345_post-1" });
    if (url.pathname.endsWith("/123456789012346/media")) return Response.json({ id: "ig-container-1" });
    if (url.pathname.endsWith("/ig-container-1")) return Response.json({ status_code: "FINISHED" });
    if (url.pathname.endsWith("/123456789012346/media_publish")) return Response.json({ id: "ig-media-1" });
    return Response.json({ error: { message: "Unexpected Meta test request" } }, { status: 404 });
  };
}
async function connectAndCallback(h, state) {
  await h.kv.put("meta:publishing:oauth-state:" + state, JSON.stringify({ uid: "user-1", createdAt: Date.now() }));
  return h.router(new Request(REDIRECT + "?state=" + state + "&code=fixture-code"), h.env);
}

test("connect requests publishing scopes and creates one-use staging state", async () => {
  const { router, env, kv } = harness();
  const response = await router(new Request(GATEWAY + "/api/communications/meta/connect", { method: "POST" }), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  const authorization = new URL(result.authorizationUrl);
  assert.deepEqual(authorization.searchParams.get("scope").split(","), REQUIRED_SCOPES);
  assert.equal(result.postingEnabled, true);
  assert.ok([...kv.values.keys()].some(key => key.startsWith("meta:publishing:oauth-state:")));
  assert.equal([...kv.values.entries()].find(([key]) => key.endsWith(":ttl"))?.[1], 600);
});

test("connect rejects unapproved origins, inactive roles and production environments", async () => {
  const wrongOrigin = harness();
  assert.equal((await wrongOrigin.router(new Request("https://example.invalid/api/communications/meta/connect", { method: "POST" }), wrongOrigin.env)).status, 403);
  const wrongRole = harness({ role: "Finance Officer" });
  assert.equal((await wrongRole.router(new Request(GATEWAY + "/api/communications/meta/connect", { method: "POST" }), wrongRole.env)).status, 403);
  const production = harness({ envOverrides: { IRPA_ENVIRONMENT: "production" } });
  assert.equal((await production.router(new Request(GATEWAY + "/api/communications/meta/connect", { method: "POST" }), production.env)).status, 403);
});

test("callback consumes expired state and refuses replay", async () => {
  const h = harness(), state = "A".repeat(43);
  await h.kv.put("meta:publishing:oauth-state:" + state, JSON.stringify({ uid: "user-1", createdAt: Date.now() - 700000 }));
  const response = await h.router(new Request(REDIRECT + "?state=" + state + "&code=fixture"), h.env);
  assert.equal(response.status, 400);
  assert.equal(await h.kv.get("meta:publishing:oauth-state:" + state), null);
});

test("callback verifies publishing scopes, stores encrypted Page tokens and returns account metadata only", async () => {
  const h = harness(), previousFetch = globalThis.fetch;
  globalThis.fetch = mockMetaFetch();
  try {
    const response = await connectAndCallback(h, "B".repeat(43));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "verified");
    assert.equal(body.postingEnabled, true);
    assert.equal(body.facebookPages[0].name, "IRPA Test Page");
    assert.equal(body.instagramAccounts[0].username, "irpa_test");
    assert.equal(body.facebookPages[0].canPublish, true);
    assert.equal(body.instagramAccounts[0].canPublish, true);
    assert.ok(!JSON.stringify(body).includes("long-token-fixture"));
    assert.ok(!JSON.stringify(body).includes("page-token-fixture"));
    const encrypted = await h.kv.get("meta:publishing:connection:user-1");
    assert.ok(encrypted);
    assert.ok(!encrypted.includes("long-token-fixture"));
    assert.ok(!encrypted.includes("page-token-fixture"));
    const status = await h.router(new Request(GATEWAY + "/api/communications/meta/status"), h.env);
    const statusBody = await status.json();
    assert.equal(statusBody.status, "verified");
    assert.equal(statusBody.postingEnabled, true);
    assert.ok(!("accessToken" in statusBody));
    assert.ok(!("access_token" in statusBody));
  } finally { globalThis.fetch = previousFetch; }
});

test("Facebook and Instagram publishing use encrypted server-side Page tokens", async () => {
  const h = harness(), previousFetch = globalThis.fetch;
  const calls = [];
  const base = mockMetaFetch();
  globalThis.fetch = async (input, init = {}) => { calls.push({ url: new URL(String(input)), init }); return base(input, init); };
  try {
    await connectAndCallback(h, "C".repeat(43));
    const facebook = await publishMetaContent(h.env, { uid: "user-1", platform: "facebook", accountId: "123456789012345", text: "Staging Facebook test" });
    assert.equal(facebook.postId, "123456789012345_post-1");
    const pagePost = calls.find(call => call.url.pathname.endsWith("/123456789012345/feed"));
    assert.equal(pagePost.init.method, "POST");
    assert.equal(pagePost.init.headers.get("Authorization"), "Bearer page-token-fixture");
    assert.equal(new URLSearchParams(pagePost.init.body).get("message"), "Staging Facebook test");
    assert.equal(pagePost.url.searchParams.has("access_token"), false);
    const instagram = await publishMetaContent(h.env, { uid: "user-1", platform: "instagram", accountId: "123456789012346", text: "Staging Instagram test", imageUrl: "https://cdn.example.test/test.jpg" });
    assert.equal(instagram.postId, "ig-media-1");
    assert.ok(calls.some(call => call.url.pathname.endsWith("/123456789012346/media_publish")));
  } finally { globalThis.fetch = previousFetch; }
});

test("missing publishing scopes fail closed and production publisher calls are rejected", async () => {
  const h = harness(), previousFetch = globalThis.fetch;
  globalThis.fetch = mockMetaFetch({ missingScopes: true });
  try {
    const response = await connectAndCallback(h, "D".repeat(43));
    assert.equal(response.status, 502);
    assert.equal(await h.kv.get("meta:publishing:connection:user-1"), null);
  } finally { globalThis.fetch = previousFetch; }
  const production = harness({ envOverrides: { IRPA_ENVIRONMENT: "production", FIREBASE_PROJECT_ID: "irpa-digital-board-governance", IRPA_PRODUCTION_CUTOVER: "true" } });
  await assert.rejects(() => publishMetaContent(production.env, { uid: "user-1", platform: "facebook", accountId: "123456789012345", text: "Do not publish" }), /isolated staging/i);
});

test("Meta publishing refuses a connected Page not explicitly allowlisted for staging", async () => {
  const h = harness(), previousFetch = globalThis.fetch;
  globalThis.fetch = mockMetaFetch();
  try {
    await connectAndCallback(h, "E".repeat(43));
    h.env.META_STAGING_ALLOWED_PAGE_IDS = "";
    await assert.rejects(() => publishMetaContent(h.env, { uid: "user-1", platform: "facebook", accountId: "123456789012345", text: "Must not publish to public Page" }), /not approved as an IRPA staging test destination/i);
  } finally { globalThis.fetch = previousFetch; }
});

test("staging disconnect removes current and legacy encrypted tokens without requiring Meta app secrets", async () => {
  const h = harness();
  await h.kv.put("meta:publishing:connection:user-1", "encrypted-current-token-record");
  await h.kv.put("meta:readonly:connection:user-1", "encrypted-legacy-token-record");
  h.env.META_APP_SECRET = "";
  h.env.META_TOKEN_ENCRYPTION_KEY = "";
  const response = await h.router(new Request(GATEWAY + "/api/communications/meta/disconnect", { method: "POST" }), h.env);
  assert.equal(response.status, 200);
  assert.equal(await h.kv.get("meta:publishing:connection:user-1"), null);
  assert.equal(await h.kv.get("meta:readonly:connection:user-1"), null);
});
