import test from "node:test";
import assert from "node:assert/strict";
import { createInductionMatchingRouter } from "../src/inductionMatching.mjs";

function makeRouter({ claims = { user_id: "u1", email: "person@example.org", token: "id-token" }, adminActive = false, invitation = { id: "invite1", email: "person@example.org", name: "Person", status: "Pending" } } = {}) {
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
async function call(route, body) {
  return route(new Request("https://worker.test/api/induction/matching-records", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {}, "/api/induction/matching-records");
}
async function withMockFirestoreFetch(fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  try { return await fn(); } finally { globalThis.fetch = originalFetch; }
}

test("induction matching rejects unauthenticated requests", async () => {
  const route = makeRouter({ claims: new Error("no auth") });
  const response = await call(route, {});
  assert.equal(response.status, 401);
});

test("induction matching rejects another user's email lookup", async () => {
  const route = makeRouter({ invitation: { id: "invite1", email: "other@example.org", name: "Other", status: "Pending" } });
  const response = await call(route, { invitationId: "invite1" });
  assert.equal(response.status, 403);
});

test("induction matching rejects malformed requests and wrong methods", async () => {
  const route = makeRouter();
  const methodResponse = await route(new Request("https://worker.test/api/induction/matching-records", { method: "GET" }), {}, "/api/induction/matching-records");
  assert.equal(methodResponse.status, 405);
  const bodyResponse = await call(route, {});
  assert.equal(bodyResponse.status, 400);
});

test("induction matching response never exposes invitation token hashes or internal fields", async () => {
  const route = makeRouter({ invitation: { id: "invite1", name: "Person", email: "person@example.org", status: "Pending", role: "member", department: "Field", createdAt: "2026-10-01T00:00:00Z", invitationTokenHash: "secret-hash", deliveryError: "SMTP detail", privateInternal: "hidden" } });
  await withMockFirestoreFetch(async () => {
    const response = await call(route, { invitationId: "invite1" });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(Object.keys(payload.invitation).sort(), ["createdAt", "department", "email", "id", "name", "role", "status"].sort());
    assert.equal(JSON.stringify(payload).includes("invitationTokenHash"), false);
    assert.equal(JSON.stringify(payload).includes("secret-hash"), false);
    assert.equal(JSON.stringify(payload).includes("deliveryError"), false);
  });
});

test("induction matching refuses expired or activated invitations for tokens without email", async () => {
  const claims = { user_id: "u1", token: "invitation-token" };
  for (const invitation of [
    { id: "invite1", email: "person@example.org", status: "Pending", expiresAt: "2000-01-01T00:00:00Z" },
    { id: "invite1", email: "person@example.org", status: "Activated", expiresAt: "2099-01-01T00:00:00Z" }
  ]) {
    const response = await call(makeRouter({ claims, invitation }), { invitationId: "invite1" });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "This invitation can no longer be used for verification.");
  }
});

test("active administrator can look up another person's email", async () => {
  const route = makeRouter({ claims: { user_id: "u1", email: "admin@example.org", token: "id-token" }, adminActive: true, invitation: { id: "invite1", email: "other@example.org", name: "Other", status: "Activated" } });
  await withMockFirestoreFetch(async () => {
    const response = await call(route, { invitationId: "invite1" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).invitation.email, "other@example.org");
  });
});
