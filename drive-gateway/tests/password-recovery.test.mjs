import test from "node:test";
import assert from "node:assert/strict";
import { createPasswordRecoveryRouter } from "../src/passwordRecovery.mjs";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function doc(id, fields) { return { name: "projects/staging/databases/(default)/documents/" + id, fields }; }
const toPlain = value => value?.fields || {};
const req = (path, body = {}, token = "") => new Request("https://gateway.test" + path, {
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
  body: JSON.stringify(body)
});

function dependencies(overrides = {}) {
  return {
    authenticateFirebaseRequest: async () => ({ user_id: "phone-session", firebaseClaims: { phoneNumber: "+255712345678" } }),
    getFirebaseAuthAdminAccessToken: async () => "auth-admin-token",
    getFirestoreAdminAccessToken: async () => "firestore-admin-token",
    getFirestoreDocumentsByField: async (_env, collection, field, email, token, limit) => {
      assert.equal(field, "email"); assert.equal(email, "member@example.test");
      assert.equal(token, "firestore-admin-token"); assert.equal(limit, 5);
      return collection === "members" ? [doc("members/member-1", { phone: "0712345678" })] : [];
    },
    getFirebaseProjectId: () => "staging-project",
    firestoreDocumentToPlain: toPlain,
    json: response,
    corsHeaders: () => ({}),
    fetchFn: async (url, options) => {
      if (String(url).includes("accounts:lookup")) return response({ users: [{ localId: "member-uid", email: "member@example.test", phoneNumber: "" }] });
      if (String(url).includes("accounts:update")) return response({ localId: "member-uid", phoneNumber: "+255712345678" });
      throw new Error("Unexpected URL " + url);
    },
    rateLimit: async () => ({ allowed: true }),
    clearRateLimit: async () => ({ ok: true }),
    ...overrides
  };
}

test("password recovery preparation resolves registered phone and updates Firebase Auth only when absent", async () => {
  const calls = [];
  const deps = dependencies({ fetchFn: async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    if (String(url).includes("accounts:lookup")) return response({ users: [{ localId: "member-uid", email: "member@example.test", phoneNumber: "" }] });
    if (String(url).includes("accounts:update")) return response({ localId: "member-uid", phoneNumber: "+255712345678" });
    throw new Error("Unexpected URL " + url);
  }});
  const route = createPasswordRecoveryRouter(deps);
  const result = await route(req("/api/auth/password-reset/prepare", { email: "Member@Example.Test" }), {}, "/api/auth/password-reset/prepare");
  const body = await result.json();
  assert.equal(result.status, 200);
  assert.deepEqual(body, { ok: true, phoneNumber: "+255712345678", maskedPhone: "+255••••678", uid: "member-uid", otpProvider: "Firebase Authentication SMS" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.phoneNumber, "+255712345678");
});

test("password recovery preparation refuses a registered/authentication phone mismatch", async () => {
  const route = createPasswordRecoveryRouter(dependencies({ fetchFn: async url => {
    if (String(url).includes("accounts:lookup")) return response({ users: [{ localId: "member-uid", email: "member@example.test", phoneNumber: "+255700000000" }] });
    throw new Error("The Auth phone should not be updated.");
  }}));
  const result = await route(req("/api/auth/password-reset/prepare", { email: "member@example.test" }), {}, "/api/auth/password-reset/prepare");
  assert.equal(result.status, 412);
});

test("password recovery preparation is rate limited before privileged account lookup", async () => {
  let lookupCalled = false;
  const route = createPasswordRecoveryRouter(dependencies({
    rateLimit: async () => ({ allowed: false, retryAfterSeconds: 300 }),
    fetchFn: async () => { lookupCalled = true; return response({}); }
  }));
  const result = await route(req("/api/auth/password-reset/prepare", { email: "member@example.test" }), {}, "/api/auth/password-reset/prepare");
  assert.equal(result.status, 429);
  assert.equal(lookupCalled, false);
});

test("password recovery preparation rejects ambiguous registered mobile numbers", async () => {
  const route = createPasswordRecoveryRouter(dependencies({
    getFirestoreDocumentsByField: async (_env, collection) => collection === "members"
      ? [doc("members/a", { phone: "0712345678" }), doc("members/b", { phone: "0711111111" })] : [],
    fetchFn: async url => String(url).includes("accounts:lookup")
      ? response({ users: [{ localId: "member-uid", email: "member@example.test" }] })
      : response({})
  }));
  const result = await route(req("/api/auth/password-reset/prepare", { email: "member@example.test" }), {}, "/api/auth/password-reset/prepare");
  assert.equal(result.status, 412);
});

test("recovery rate limit clears only after Firebase phone-token matches registered mobile", async () => {
  let cleared = false;
  const route = createPasswordRecoveryRouter(dependencies({
    clearRateLimit: async () => { cleared = true; return { ok: true }; }
  }));
  const result = await route(req("/api/auth/password-reset/clear", { email: "member@example.test" }, "phone-token"), {}, "/api/auth/password-reset/clear");
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true });
  assert.equal(cleared, true);
});

test("recovery rate limit is not cleared by an unrelated phone number", async () => {
  const route = createPasswordRecoveryRouter(dependencies({
    authenticateFirebaseRequest: async () => ({ user_id: "other-phone", firebaseClaims: { phoneNumber: "+255799999999" } })
  }));
  const result = await route(req("/api/auth/password-reset/clear", { email: "member@example.test" }, "phone-token"), {}, "/api/auth/password-reset/clear");
  assert.equal(result.status, 403);
});
