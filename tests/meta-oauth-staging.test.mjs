import test from "node:test";
import assert from "node:assert/strict";
import { createMetaOAuthRouter } from "../drive-gateway/src/metaOAuth.mjs";

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
    META_GRAPH_API_VERSION: "v24.0",
    META_APP_ID: "test-app-id",
    META_APP_SECRET: "test-secret-not-real",
    META_TOKEN_ENCRYPTION_KEY: key,
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

test("Meta connect is locked to the isolated staging Firebase project", async () => {
  const { env, router } = harness({ FIREBASE_PROJECT_ID: "irpa-digital-board-governance" });
  const response = await router(new Request(STAGING_GATEWAY + "/api/communications/meta/connect", {
    method: "POST", headers: { authorization: "Bearer placeholder" }
  }), env);
  const result = await read(response);
  assert.equal(result.status, 403);
  assert.match(result.body.error, /isolated staging/i);
});

test("Meta OAuth requests only the documented read-only scopes and stores one-use state", async () => {
  const { env, values, router } = harness();
  const response = await router(new Request(STAGING_GATEWAY + "/api/communications/meta/connect", {
    method: "POST", headers: { authorization: "Bearer placeholder" }
  }), env);
  const result = await read(response);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.postingEnabled, false);
  const authorization = new URL(result.body.authorizationUrl);
  assert.equal(authorization.hostname, "www.facebook.com");
  assert.equal(authorization.searchParams.get("redirect_uri"), REDIRECT);
  assert.deepEqual(authorization.searchParams.get("scope").split(","), [
    "pages_show_list", "pages_read_engagement", "instagram_basic"
  ]);
  assert.equal(authorization.searchParams.has("state"), true);
  assert.equal([...values.keys()].filter(k => k.startsWith("meta:readonly:oauth-state:")).length, 2);
  assert.equal([...values.entries()].find(([k]) => k.endsWith(":ttl"))?.[1], 600);
  assert.equal(result.body.accessToken, undefined);
});

test("Meta status reports not connected without returning secrets or enabling posting", async () => {
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

test("Meta callback refuses requests outside the exact staging gateway", async () => {
  const { env, router } = harness();
  const response = await router(new Request("https://irpa.or.tz/api/communications/meta/callback?code=unused&state=unused"), env);
  const result = await read(response);
  assert.equal(result.status, 403);
  assert.equal(result.body.ok, false);
});
