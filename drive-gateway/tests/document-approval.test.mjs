import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentApprovalRouter } from "../src/documentApproval.mjs";

const PATH = "/api/document-lifecycle/approval/decide";
const claims = { user_id: "officer-1", email: "officer@irpa.or.tz", token: "test-token" };
const signedDocument = {
  documentId: "doc-1",
  status: "SIGNED",
  signatureStatus: "COMPLETED",
  signatureEnvelopeId: "env-1",
  signedByUid: "signer-1"
};
const completedEnvelope = { documentId: "doc-1", status: "Completed", lastSignedByUid: "signer-1" };

function setup(overrides = {}) {
  const store = {
    "adminProfiles/officer-1": null,
    "members/officer-1": { status: "Active", role: "Authorization Officer" },
    "employees/officer-1": null,
    "documents/doc-1": structuredClone(signedDocument),
    "signatureEnvelopes/env-1": structuredClone(completedEnvelope),
    ...(overrides.store || {})
  };
  const commits = [];
  const deps = {
    authenticateFirebaseRequest: async () => claims,
    getFirestoreDocument: async (_env, path) => {
      const value = store[path];
      return value ? { fields: value } : null;
    },
    firestoreDocumentToPlain: raw => raw?.fields || null,
    commitDocumentAndAudit: async (_env, documentId, _token, fields, mask, audit) => {
      commits.push({ documentId, fields, mask, audit });
      if (store["documents/" + documentId]?.approval) throw new Error("already exists");
      store["documents/" + documentId].approval = fields.approval?.mapValue?.fields
        ? Object.fromEntries(Object.entries(fields.approval.mapValue.fields).map(([k,v]) => [k, v.stringValue ?? v.nullValue ?? v.timestampValue]))
        : fields.approval;
      return {};
    },
    json: (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers }),
    corsHeaders: () => ({})
  };
  Object.assign(deps, overrides.deps || {});
  const router = createDocumentApprovalRouter(deps);
  const request = (body = { documentId: "doc-1", decision: "approve" }, method = "POST") =>
    new Request("https://worker.test" + PATH, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined });
  return { router, request, store, commits, env: {} };
}
async function call(ctx, body, method) {
  const response = await ctx.router(ctx.request(body, method), ctx.env, PATH);
  return { response, data: await response.json() };
}

test("rejects unauthenticated callers", async () => {
  const ctx = setup({ deps: { authenticateFirebaseRequest: async () => { throw Object.assign(new Error("Firebase authentication is required."), { status: 401 }); } } });
  const result = await call(ctx);
  assert.equal(result.response.status, 401);
  assert.equal(ctx.commits.length, 0);
});

test("rejects callers without the Authorization Officer role", async () => {
  const ctx = setup({ store: { "members/officer-1": { status: "Active", role: "Member" } } });
  const result = await call(ctx);
  assert.equal(result.response.status, 403);
  assert.match(result.data.error, /Authorization Officer/);
});

test("rejects a missing document with 409", async () => {
  const ctx = setup({ store: { "documents/doc-1": null } });
  const result = await call(ctx);
  assert.equal(result.response.status, 409);
  assert.match(result.data.error, /document does not exist/i);
});

test("rejects missing, incomplete, or mismatched signature envelopes with 409", async t => {
  await t.test("missing envelope", async () => {
    const ctx = setup({ store: { "signatureEnvelopes/env-1": null } });
    const result = await call(ctx);
    assert.equal(result.response.status, 409);
  });
  await t.test("incomplete envelope", async () => {
    const ctx = setup({ store: { "signatureEnvelopes/env-1": { documentId: "doc-1", status: "Sent" } } });
    const result = await call(ctx);
    assert.equal(result.response.status, 409);
  });
  await t.test("envelope belongs to another document", async () => {
    const ctx = setup({ store: { "signatureEnvelopes/env-1": { documentId: "doc-other", status: "Completed" } } });
    const result = await call(ctx);
    assert.equal(result.response.status, 409);
  });
  await t.test("document has no linked envelope", async () => {
    const ctx = setup({ store: { "documents/doc-1": { ...signedDocument, signatureEnvelopeId: "" } } });
    const result = await call(ctx);
    assert.equal(result.response.status, 409);
  });
});

test("requires a reason for rejection", async () => {
  const ctx = setup();
  const result = await call(ctx, { documentId: "doc-1", decision: "reject", reason: "  " });
  assert.equal(result.response.status, 400);
  assert.equal(ctx.commits.length, 0);
});

test("rejects a second decision", async () => {
  const ctx = setup({ store: { "documents/doc-1": { ...signedDocument, approval: { decision: "approve" } } } });
  const result = await call(ctx);
  assert.equal(result.response.status, 409);
  assert.match(result.data.error, /already been recorded/i);
});

test("enforces separation of duties: the signer cannot decide", async () => {
  const ctx = setup({ deps: { authenticateFirebaseRequest: async () => ({ ...claims, user_id: "signer-1" }) }, store: {
    "members/signer-1": { status: "Active", role: "Authorization Officer" },
    "members/officer-1": null,
    "documents/doc-1": { ...signedDocument, signedByUid: "signer-1" }
  } });
  const result = await call(ctx);
  assert.equal(result.response.status, 403);
  assert.match(result.data.error, /signer cannot/i);
  assert.equal(ctx.commits.length, 0);
});

test("records approval and an audit event for an authorized decision", async () => {
  const ctx = setup();
  const result = await call(ctx, { documentId: "doc-1", decision: "approve", reason: "Reviewed" });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.approval.documentId, "doc-1");
  assert.equal(result.data.approval.envelopeId, "env-1");
  assert.equal(result.data.approval.officerUid, "officer-1");
  assert.equal(result.data.approval.decision, "approve");
  assert.equal(ctx.commits.length, 1);
  assert.ok(ctx.commits[0].mask.includes("approval"));
  assert.equal(ctx.commits[0].audit.action.stringValue, "DOCUMENT_APPROVAL_APPROVE");
});

test("records a rejection with its reason", async () => {
  const ctx = setup();
  const result = await call(ctx, { documentId: "doc-1", decision: "reject", reason: "Missing board resolution" });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.approval.reason, "Missing board resolution");
  assert.equal(ctx.commits[0].audit.action.stringValue, "DOCUMENT_APPROVAL_REJECT");
});

test("returns 405 for methods other than POST", async () => {
  const ctx = setup();
  const result = await call(ctx, undefined, "GET");
  assert.equal(result.response.status, 405);
});
