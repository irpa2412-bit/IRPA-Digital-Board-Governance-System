import test from "node:test";
import assert from "node:assert/strict";
import { createMetaOAuthRouter } from "../src/metaOAuth.mjs";

const GATEWAY = "https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev";
const SCOPES = ["pages_show_list", "pages_read_engagement", "instagram_basic"];
function makeKv() {
  const values = new Map();
  return {
    values,
    async get(key) { return values.get(key) ?? null; },
    async put(key, value) { values.set(key, String(value)); },
    async delete(key) { values.delete(key); }
  };
}
function harness({ role = "Communications Officer", envOverrides = {} } = {}) {
  const kv = makeKv();
  const env = {
    IRPA_ENVIRONMENT: "staging",
    FIREBASE_PROJECT_ID: "irpa-dbg-staging-a73ec",
    IRPA_PRODUCTION_CUTOVER: "false",
    META_APP_ID: "12345678901234",
    META_APP_SECRET: "test-only-not-a-real-secret",
    META_TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
    META_REDIRECT_URI: GATEWAY + "/api/communications/meta/callback",
    META_GRAPH_API_VERSION: "v26.0",
    DRIVE_KV: kv,
    ...envOverrides
  };
  const router = createMetaOAuthRouter({
    authenticateFirebaseRequest: async () => ({ user_id: "user-1", email: "tester@example.invalid", token: "firebase-test-token" }),
    getFirestoreDocument: async () => null,
    getInstitutionalProfileForUser: async () => ({
      memberRecord: { fields: { status: { stringValue: "Active" }, role: { stringValue: role } } }
    }),
    firestoreDocumentToPlain: doc => doc?.fields
      ? Object.fromEntries(Object.entries(doc.fields).map(([key, value]) => [key, value.stringValue ?? value.booleanValue ?? null]))
      : doc,
    json: (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
      status, headers: { "Content-Type": "application/json", ...headers }
    }),
    corsHeaders: () => ({ "Access-Control-Allow-Origin": "https://irpa-dgb-meeting-room-staging.irpa-governance.workers.dev" })
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
      return Response.json({ error: { message: "Unexpected token exchange request" } }, { status: 400 });
    }
    if (url.pathname.endsWith("/me/permissions")) {
      const permissions = missingScopes ? [{ permission: SCOPES[0], status: "granted" }]
        : SCOPES.map(permission => ({ permission, status: "granted" }));
      return Response.json({ data: permissions });
    }
    if (url.pathname.endsWith("/me/accounts")) {
      return Response.json({ data: [{
        id: "page-123", name: "IRPA Test Page",
        instagram_business_account: { id: "ig-456", username: "irpa_test", account_type: "BUSINESS" }
      }] });
    }
    if (url.pathname.endsWith("/me")) return Response.json({ id: "meta-user-1", name: "IRPA Test User" });
    return Response.json({ error: { message: "Unexpected Meta test request" } }, { status: 404 });
  };
}

test("connect returns a read-only Meta authorization URL and one-time staging state", async () => {
  const { router, env, kv } = harness();
  const response = await router(new Request(GATEWAY + "/api/communications/meta/connect", {
    method: "POST", headers: { Authorization: "Bearer fixture" }
  }), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  const authorization = new URL(result.authorizationUrl);
  assert.equal(authorization.hostname, "www.facebook.com");
  assert.deepEqual(authorization.searchParams.get("scope").split(","), SCOPES);
  assert.equal(result.postingEnabled, false);
  assert.ok([...kv.values.keys()].some(key => key.startsWith("meta:readonly:oauth-state:")));
  assert.ok(!authorization.searchParams.get("scope").includes("pages_manage_posts"));
});

test("connect and status deny unapproved origins, inactive roles and non-staging environments", async () => {
  const origin = harness();
  const wrongOrigin = await origin.router(new Request("https://example.invalid/api/communications/meta/connect", { method: "POST" }), origin.env);
  assert.equal(wrongOrigin.status, 403);
  const wrongRole = harness({ role: "Finance Officer" });
  const denied = await wrongRole.router(new Request(GATEWAY + "/api/communications/meta/connect", { method: "POST" }), wrongRole.env);
  assert.equal(denied.status, 403);
  const production = harness({ envOverrides: { IRPA_ENVIRONMENT: "production" } });
  const productionDenied = await production.router(new Request(GATEWAY + "/api/communications/meta/connect", { method: "POST" }), production.env);
  assert.equal(productionDenied.status, 403);
  const cutover = harness({ envOverrides: { IRPA_PRODUCTION_CUTOVER: "true" } });
  const cutoverDenied = await cutover.router(new Request(GATEWAY + "/api/communications/meta/connect", { method: "POST" }), cutover.env);
  assert.equal(cutoverDenied.status, 403);
});

test("callback rejects missing or replayed OAuth state without calling Meta", async () => {
  const { router, env, kv } = harness();
  const missing = await router(new Request(GATEWAY + "/api/communications/meta/callback?code=fixture"), env);
  assert.equal(missing.status, 400);
  const state = "A".repeat(43);
  await kv.put("meta:readonly:oauth-state:" + state, JSON.stringify({ uid: "user-1", createdAt: Date.now() - 700000 }));
  const expired = await router(new Request(GATEWAY + "/api/communications/meta/callback?state=" + state + "&code=fixture"), env);
  assert.equal(expired.status, 400);
  assert.equal(await kv.get("meta:readonly:oauth-state:" + state), null);
});

test("OAuth callback verifies Pages and linked Instagram, encrypts tokens and never returns token material", async () => {
  const { router, env, kv } = harness();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockMetaFetch();
  try {
    const state = "B".repeat(43);
    await kv.put("meta:readonly:oauth-state:" + state, JSON.stringify({ uid: "user-1", createdAt: Date.now() }));
    const response = await router(new Request(GATEWAY + "/api/communications/meta/callback?state=" + state + "&code=fixture-code"), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "verified");
    assert.equal(body.postingEnabled, false);
    assert.equal(body.facebookPages[0].name, "IRPA Test Page");
    assert.equal(body.instagramAccounts[0].username, "irpa_test");
    assert.ok(!JSON.stringify(body).includes("long-token-fixture"));
    const encrypted = await kv.get("meta:readonly:connection:user-1");
    assert.ok(encrypted);
    assert.ok(!encrypted.includes("long-token-fixture"));
    assert.ok(!encrypted.includes("short-token-fixture"));
    const status = await router(new Request(GATEWAY + "/api/communications/meta/status", {
      headers: { Authorization: "Bearer fixture" }
    }), env);
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.status, "verified");
    assert.equal(statusBody.postingEnabled, false);
    assert.ok(!("accessToken" in statusBody));
    assert.ok(!("access_token" in statusBody));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("missing required Meta scopes fail closed without persisting an encrypted token", async () => {
  const { router, env, kv } = harness();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockMetaFetch({ missingScopes: true });
  try {
    const state = "C".repeat(43);
    await kv.put("meta:readonly:oauth-state:" + state, JSON.stringify({ uid: "user-1", createdAt: Date.now() }));
    const response = await router(new Request(GATEWAY + "/api/communications/meta/callback?state=" + state + "&code=fixture-code"), env);
    assert.equal(response.status, 502);
    assert.equal(await kv.get("meta:readonly:connection:user-1"), null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
