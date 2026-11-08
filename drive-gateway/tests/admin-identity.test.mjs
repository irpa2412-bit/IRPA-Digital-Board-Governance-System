import test from "node:test";
import assert from "node:assert/strict";
import { createBootstrapPrimaryAdministratorRoute } from "../src/adminIdentity.mjs";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function request(method = "POST") {
  return new Request("https://gateway.test/api/auth/bootstrap-primary-administrator", { method });
}

test("primary administrator bootstrap rejects unauthenticated requests", async () => {
  const route = createBootstrapPrimaryAdministratorRoute({
    authenticateFirebaseRequest: async () => { throw new Error("Firebase authentication is required."); },
    getFirebaseAuthAdminAccessToken: async () => "auth-token",
    getFirestoreAdminAccessToken: async () => "firestore-token",
    getFirebaseProjectId: () => "staging-project",
    json: response, corsHeaders: () => ({})
  });
  const result = await route(request(), {});
  assert.equal(result.status, 401);
});

test("primary administrator bootstrap rejects any non-designated email before privileged calls", async () => {
  let privilegedCalls = 0;
  const route = createBootstrapPrimaryAdministratorRoute({
    authenticateFirebaseRequest: async () => ({ user_id: "other-uid", email: "other@example.test" }),
    getFirebaseAuthAdminAccessToken: async () => { privilegedCalls++; return "auth-token"; },
    getFirestoreAdminAccessToken: async () => { privilegedCalls++; return "firestore-token"; },
    getFirebaseProjectId: () => "staging-project",
    json: response, corsHeaders: () => ({})
  });
  const result = await route(request(), {});
  assert.equal(result.status, 403);
  assert.equal(privilegedCalls, 0);
});

test("primary administrator bootstrap preserves existing custom claims and commits profile plus audit", async () => {
  const calls = [];
  const route = createBootstrapPrimaryAdministratorRoute({
    authenticateFirebaseRequest: async (_request, _env, options) => {
      assert.equal(options.skipActivation, true);
      return { user_id: "primary-uid", email: "irpa2412@gmail.com" };
    },
    getFirebaseAuthAdminAccessToken: async () => "auth-token",
    getFirestoreAdminAccessToken: async () => "firestore-token",
    getFirebaseProjectId: () => "staging-project",
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("accounts:lookup")) return response({ users: [{ localId: "primary-uid", displayName: "Primary Admin", customAttributes: JSON.stringify({ irpaRoles: ["Executive Director"], customFlag: true }) }] });
      if (String(url).includes("accounts:update")) return response({ localId: "primary-uid" });
      if (String(url).includes("documents:commit")) return response({ writeResults: [{}, {}] });
      return response({}, 404);
    },
    json: response, corsHeaders: () => ({})
  });
  const result = await route(request(), {});
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, uid: "primary-uid", email: "irpa2412@gmail.com" });
  const authUpdate = calls.find(call => call.url.includes("accounts:update"));
  const authBody = JSON.parse(authUpdate.options.body);
  assert.deepEqual(JSON.parse(authBody.customAttributes), { irpaRoles: ["Executive Director"], customFlag: true, admin: true });
  const commit = calls.find(call => call.url.includes("documents:commit"));
  const commitBody = JSON.parse(commit.options.body);
  assert.equal(commitBody.writes.length, 2);
  assert.equal(commitBody.writes[0].update.fields.active.booleanValue, true);
  assert.equal(commitBody.writes[1].update.fields.action.stringValue, "PRIMARY_ADMINISTRATOR_BOOTSTRAPPED");
});

test("primary administrator bootstrap rolls back custom claims when Firestore commit fails", async () => {
  const calls = [];
  const route = createBootstrapPrimaryAdministratorRoute({
    authenticateFirebaseRequest: async () => ({ user_id: "primary-uid", email: "irpa2412@gmail.com" }),
    getFirebaseAuthAdminAccessToken: async () => "auth-token",
    getFirestoreAdminAccessToken: async () => "firestore-token",
    getFirebaseProjectId: () => "staging-project",
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("accounts:lookup")) return response({ users: [{ localId: "primary-uid", customAttributes: JSON.stringify({ existing: "claim" }) }] });
      if (String(url).includes("accounts:update")) return response({ localId: "primary-uid" });
      if (String(url).includes("documents:commit")) return response({ error: "failed" }, 503);
      return response({}, 404);
    },
    json: response, corsHeaders: () => ({})
  });
  const result = await route(request(), {});
  assert.equal(result.status, 500);
  const updates = calls.filter(call => call.url.includes("accounts:update")).map(call => JSON.parse(call.options.body).customAttributes);
  assert.deepEqual(updates.map(JSON.parse), [{ existing: "claim", admin: true }, { existing: "claim" }]);
});
