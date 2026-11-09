import test from "node:test";
import assert from "node:assert/strict";
import { createMetaOAuthRouter, publishMetaContent, REQUIRED_SCOPES } from "../drive-gateway/src/metaOAuth.mjs";

const STAGING_GATEWAY = "https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev";
const REDIRECT = STAGING_GATEWAY + "/api/communications/meta/callback";
const key = Buffer.alloc(32, 7).toString("base64");

function harness(overrides = {}) {
  const values = new Map();
  const env = {
    IRPA_ENVIRONMENT: "staging",
    FIREBASE_PROJECT_ID: "irpa-dbg-staging-a73ec",
    IRPA_PRODUCTION_CUTOVER: "false",
    META_REDIRECT_URI: REDIRECT,
    META_GRAPH_API_VERSION: "v26.0",
    META_APP_ID: "test-app-id",
    META_APP_SECRET: "test-secret-not-real",
    META_TOKEN_ENCRYPTION_KEY: key, META_STAGING_ALLOWED_PAGE_IDS: "page-1", META_STAGING_ALLOWED_INSTAGRAM_IDS: "ig-1",
    DRIVE_KV: {
      async put(k, v, options) { values.set(k, v); if (options) values.set(k + ":ttl", options.expirationTtl); },
      async get(k) { return values.get(k) ?? null; },
      async delete(k) { values.delete(k); }
    },
    ...overrides
  };
  const deps = {
    authenticateFirebaseRequest: async () => ({ user_id: "staging-user", token: "test-id-token" }),
    getFirestoreDocument: async () => ({ active: true }),
    getInstitutionalProfileForUser: async () => ({}),
    firestoreDocumentToPlain: value => value,
    json: (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers }),
    corsHeaders: () => ({ "content-type": "application/json" })
  };
  return { env, values, router: createMetaOAuthRouter(deps) };
}

async function read(response) {
  return { status: response.status, body: await response.json() };
}

test("Meta publishing OAuth is locked to the isolated staging Firebase project", async () => {
  const { env, router } = harness({ FIREBASE_PROJECT_ID: "irpa-digital-board-governance" });
  const response = await router(new Request(STAGING_GATEWAY + "/api/communications/meta/connect", {
    method: "POST", headers: { authorization: "Bearer placeholder" }
  }), env);
  const result = await read(response);
  assert.equal(result.status, 403);
  assert.match(result.body.error, /isolated staging/i);
});

test("Meta OAuth requests Page and Instagram publishing permissions and stores one-use state", async () => {
  const { env, values, router } = harness();
  const response = await router(new Request(STAGING_GATEWAY + "/api/communications/meta/connect", {
    method: "POST", headers: { authorization: "Bearer placeholder" }
  }), env);
  const result = await read(response);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.postingEnabled, true);
  const authorization = new URL(result.body.authorizationUrl);
  assert.equal(authorization.hostname, "www.facebook.com");
  assert.equal(authorization.searchParams.get("redirect_uri"), REDIRECT);
  assert.deepEqual(authorization.searchParams.get("scope").split(","), REQUIRED_SCOPES);
  assert.equal(authorization.searchParams.has("state"), true);
  assert.equal([...values.keys()].filter(k => k.startsWith("meta:publishing:oauth-state:")).length, 2);
  assert.equal([...values.entries()].find(([k]) => k.endsWith(":ttl"))?.[1], 600);
  assert.equal(result.body.accessToken, undefined);
});

test("Meta status reports not connected without returning secrets", async () => {
  const { env, router } = harness();
  const response = await router(new Request(STAGING_GATEWAY + "/api/communications/meta/status", {
    method: "GET", headers: { authorization: "Bearer placeholder" }
  }), env);
  const result = await read(response);
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "not_connected");
  assert.equal(result.body.postingEnabled, false);
  assert.equal(result.body.accessToken, undefined);
});

test("Meta callback stores encrypted Page credentials and Facebook publishing uses the server-side Page token", async () => {
  const { env, values, router } = harness();
  const connect = await read(await router(new Request(STAGING_GATEWAY + "/api/communications/meta/connect", { method: "POST" }), env));
  const state = new URL(connect.body.authorizationUrl).searchParams.get("state");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname.endsWith("/oauth/access_token")) {
      const form = new URLSearchParams(init.body || "");
      return Response.json(form.has("grant_type")
        ? { access_token: "long-user-token", expires_in: 5184000 }
        : { access_token: "short-user-token", expires_in: 3600 });
    }
    if (url.pathname.endsWith("/me/permissions")) return Response.json({ data: REQUIRED_SCOPES.map(permission => ({ permission, status: "granted" })) });
    if (url.pathname.endsWith("/me/accounts")) return Response.json({ data: [{
      id: "page-1", name: "IRPA Staging Test Page", access_token: "page-secret-token",
      tasks: ["CREATE_CONTENT"], instagram_business_account: { id: "ig-1", username: "irpa_test", account_type: "BUSINESS" }
    }] });
    if (url.pathname.endsWith("/me")) return Response.json({ id: "meta-user-1", name: "IRPA Test Admin" });
    if (url.pathname.endsWith("/page-1/feed")) return Response.json({ id: "page-1_post-1" });
    if (url.pathname.endsWith("/ig-1/media")) return Response.json({ id: "ig-container-1" });
    if (url.pathname.endsWith("/ig-container-1")) return Response.json({ status_code: "FINISHED", status: "Finished" });
    if (url.pathname.endsWith("/ig-1/media_publish")) return Response.json({ id: "ig-media-1" });
    return Response.json({ error: { message: "Unexpected test endpoint" } }, { status: 500 });
  };
  try {
    const callback = await read(await router(new Request(REDIRECT + "?code=authorized-code&state=" + state), env));
    assert.equal(callback.status, 200);
    assert.equal(callback.body.status, "verified");
    assert.equal(callback.body.postingEnabled, true);
    assert.equal(callback.body.facebookPages[0].canPublish, true);
    assert.equal(callback.body.instagramAccounts[0].canPublish, true);
    assert.equal(callback.body.accessToken, undefined);
    assert.equal(JSON.stringify(callback.body).includes("page-secret-token"), false);
    const encrypted = values.get("meta:publishing:connection:staging-user");
    assert.ok(encrypted);
    assert.equal(encrypted.includes("page-secret-token"), false);

    const facebook = await publishMetaContent(env, { uid: "staging-user", platform: "facebook", accountId: "page-1", text: "Controlled staging test post" });
    assert.equal(facebook.postId, "page-1_post-1");
    const pagePost = calls.find(call => call.url.pathname.endsWith("/page-1/feed"));
    assert.equal(pagePost.init.method, "POST");
    assert.equal(pagePost.init.headers.get("Authorization"), "Bearer page-secret-token");
    assert.equal(new URLSearchParams(pagePost.init.body).get("message"), "Controlled staging test post");
    assert.equal(pagePost.url.searchParams.has("access_token"), false);

    const instagram = await publishMetaContent(env, { uid: "staging-user", platform: "instagram", accountId: "ig-1", text: "Instagram staging test", imageUrl: "https://cdn.example.test/irpa-test.jpg" });
    assert.equal(instagram.postId, "ig-media-1");
    assert.ok(calls.some(call => call.url.pathname.endsWith("/ig-1/media")));
    assert.ok(calls.some(call => call.url.pathname.endsWith("/ig-1/media_publish")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Meta callback refuses requests outside the exact staging gateway", async () => {
  const { env, router } = harness();
  const response = await router(new Request("https://irpa.or.tz/api/communications/meta/callback?code=unused&state=unused"), env);
  const result = await read(response);
  assert.equal(result.status, 403);
  assert.equal(result.body.ok, false);
});

test("Meta publisher refuses production environment even with a stored staging-shaped token", async () => {
  const { env } = harness({ IRPA_ENVIRONMENT: "production", FIREBASE_PROJECT_ID: "irpa-digital-board-governance", IRPA_PRODUCTION_CUTOVER: "true" });
  await assert.rejects(() => publishMetaContent(env, { uid: "staging-user", platform: "facebook", accountId: "page-1", text: "must not publish" }), /isolated staging/i);
});
