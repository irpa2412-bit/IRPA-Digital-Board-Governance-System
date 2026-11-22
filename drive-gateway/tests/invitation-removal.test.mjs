import test from "node:test";
import assert from "node:assert/strict";
import { createInvitationRemovalRouter } from "../src/invitationRemoval.mjs";

function firestoreDoc(name, fields, updateTime = "2026-10-19T10:00:00.000000Z") {
  return { name, updateTime, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key,
    typeof value === "boolean" ? { booleanValue: value } :
    typeof value === "number" ? { integerValue: String(value) } :
    value === null ? { nullValue: null } : { stringValue: String(value) }
  ])) };
}
function setup({ actor = { token: "verified.jwt.token", user_id: "admin-1", email: "admin@example.org" }, admin = { active: true }, invitation = firestoreDoc("projects/test/databases/(default)/documents/invitations/inv-1", { email: "invitee@example.org", status: "Pending" }), commitStatus = 200 } = {}) {
  const calls = [];
  const ctx = {
    authenticateFirebaseRequest: async () => { if (!actor) throw new Error("Firebase authentication is required."); return actor; },
    getFirebaseProjectId: () => "test",
    getFirestoreAdminAccessToken: async () => "service-token",
    getFirestoreDocument: async (_env, path) => path === "adminProfiles/admin-1" ? (admin ? firestoreDoc("adminProfiles/admin-1", admin) : null) : (path === "invitations/inv-1" ? invitation : null),
    firestoreDocumentToPlain: doc => Object.fromEntries(Object.entries(doc?.fields || {}).map(([key, value]) => [key, value.booleanValue ?? value.stringValue ?? null])),
    json: (body, status, headers) => new Response(JSON.stringify(body), { status, headers }),
    corsHeaders: () => ({ "Content-Type": "application/json" })
  };
  const router = createInvitationRemovalRouter(ctx);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({}), { status: commitStatus });
  };
  return {
    calls,
    async run(body = { invitationId: "inv-1" }) {
      return router(new Request("https://gateway.example/api/invitations/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), {}, "/api/invitations/remove");
    },
    restore() { globalThis.fetch = oldFetch; }
  };
}

test("unmatched routes are not handled", async () => {
  const router = createInvitationRemovalRouter({});
  assert.equal(await router(new Request("https://gateway.example/health"), {}, "/health"), null);
});

test("rejects requests without verified authentication", async () => {
  const s = setup({ actor: null });
  try {
    const response = await s.run();
    assert.equal(response.status, 401);
    assert.equal((await response.json()).ok, false);
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); }
});

test("rejects non-admin users before reading or deleting invitations", async () => {
  const s = setup({ admin: null });
  try {
    const response = await s.run();
    assert.equal(response.status, 403);
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); }
});

test("preserves meeting-linked invitation records", async () => {
  const s = setup({ invitation: firestoreDoc("projects/test/databases/(default)/documents/invitations/inv-1", { meetingId: "meeting-1", status: "Pending" }) });
  try {
    const response = await s.run();
    assert.equal(response.status, 409);
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); }
});

test("preserves activated identities", async () => {
  const s = setup({ invitation: firestoreDoc("projects/test/databases/(default)/documents/invitations/inv-1", { accountActivated: true, status: "Activated" }) });
  try {
    const response = await s.run();
    assert.equal(response.status, 409);
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); }
});

test("atomically deletes pending invitation and writes audit event", async () => {
  const s = setup();
  try {
    const response = await s.run();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, invitationId: "inv-1" });
    assert.equal(s.calls.length, 1);
    assert.match(s.calls[0].url, /documents:commit$/);
    const writes = s.calls[0].body.writes;
    assert.equal(writes.length, 2);
    assert.equal(writes[0].delete, "projects/test/databases/(default)/documents/invitations/inv-1");
    assert.equal(writes[0].currentDocument.updateTime, "2026-10-19T10:00:00.000000Z");
    assert.equal(writes[1].update.fields.action.stringValue, "INVITATION_REGISTER_REMOVE");
    assert.equal(writes[1].currentDocument.exists, false);
  } finally { s.restore(); }
});

test("does not report success when Firestore commit fails", async () => {
  const s = setup({ commitStatus: 503 });
  try {
    const response = await s.run();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).ok, false);
    assert.equal(s.calls.length, 1);
  } finally { s.restore(); }
});
