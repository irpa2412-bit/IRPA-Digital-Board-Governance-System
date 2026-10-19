import test from "node:test";
import assert from "node:assert/strict";
import { createInductionMatchingRouter } from "../src/inductionMatching.mjs";

function makeRouter({ claims = { user_id: "u1", email: "person@example.org", token: "id-token" }, adminActive = false, invitation = { id: "invite1", email: "person@example.org", name: "Person" }, queryRows = [] } = {}) {
  return createInductionMatchingRouter({
    authenticateFirebaseRequest: async () => {
      if (claims instanceof Error) throw claims;
      return claims;
    },
    getFirebaseProjectId: () => "irpa-test",
    getFirestoreAdminAccessToken: async () => "service-token",
    getFirestoreDocument: async (_env, path) => {
      if (path === "adminProfiles/u1") return adminActive ? { fields: { active: { booleanValue: true } } } : null;
      if (path === "invitations/invite1") return invitation ? { name: "projects/irpa-test/databases/(default)/documents/invitations/invite1", fields: Object.fromEntries(Object.entries(invitation).filter(([k]) => k !== "id").map(([k,v]) => [k, typeof v === "boolean" ? { booleanValue: v } : { stringValue: String(v) }])) } : null;
      return null;
    },
    json: (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers }),
    corsHeaders: () => ({ "content-type": "application/json" })
  });
}

test("induction matching rejects unauthenticated requests", async () => {
  const route = makeRouter({ claims: new Error("no auth") });
  const response = await route(new Request("https://worker.test/api/induction/matching-records", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), {}, "/api/induction/matching-records");
  assert.equal(response.status, 401);
});

test("induction matching rejects another user's invitation", async () => {
  const route = makeRouter({ invitation: { id: "invite1", email: "other@example.org", name: "Other" } });
  const response = await route(new Request("https://worker.test/api/induction/matching-records", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invitationId: "invite1" }) }), {}, "/api/induction/matching-records");
  assert.equal(response.status, 403);
});

test("induction matching rejects malformed requests and wrong methods", async () => {
  const route = makeRouter();
  const methodResponse = await route(new Request("https://worker.test/api/induction/matching-records", { method: "GET" }), {}, "/api/induction/matching-records");
  assert.equal(methodResponse.status, 405);
  const bodyResponse = await route(new Request("https://worker.test/api/induction/matching-records", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), {}, "/api/induction/matching-records");
  assert.equal(bodyResponse.status, 400);
});
