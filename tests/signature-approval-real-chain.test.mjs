import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentApprovalRouter } from "../drive-gateway/src/documentApproval.mjs";

const requestFor = (actorUid, body) => new Request("https://worker.test/api/document-lifecycle/approval/decide", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer emulator-test-token" },
  body: JSON.stringify(body)
});

// Focused regression for the real approval handler. The in-memory dependency adapter
// creates no Firestore records. Full client-to-Worker chain cases are explicitly TODO.
function approvalHarness({ mirrorStatus = "Completed", actorUid = "officer-1", officer = true, priorDecision = false } = {}) {
  const writes = [];
  const audits = [];
  const reads = [];
  const records = {
    "adminProfiles/officer-1": officer ? { role: "Authorization Officer", status: "active" } : null,
    "members/officer-1": null,
    "employees/officer-1": null,
    "documents/doc-real-handler": {
      signatureEnvelopeId: "env-real-handler",
      status: "PENDING_SIGNATURE",
      ...(priorDecision ? { approvalStatus: "APPROVED", approval: { decision: "approve" } } : {})
    },
    "signatureEnvelopes/env-real-handler": {
      id: "env-real-handler",
      documentId: "doc-real-handler",
      status: mirrorStatus,
      lastSignedByUid: "signer-1",
      gatewayEnvelopeId: "worker-env-real-handler",
      gatewayFinalHash: "a".repeat(64)
    }
  };
  const handler = createDocumentApprovalRouter({
    authenticateFirebaseRequest: async () => ({ user_id: actorUid, email: actorUid + "@example.test", token: "emulator-test-token" }),
    getFirestoreDocument: async (_env, path) => { reads.push(path); return records[path] ?? null; },
    firestoreDocumentToPlain: record => record,
    commitDocumentAndAudit: async (_env, documentId, _token, patch, _mask, audit) => {
      writes.push({ documentId, patch });
      audits.push(audit);
    },
    json: (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers }),
    corsHeaders: () => ({ "content-type": "application/json" })
  });
  return {
    call: () => handler(requestFor(actorUid, { documentId: "doc-real-handler", decision: "approve" }), {
      FIREBASE_PROJECT_ID: "demo-irpa-staging",
      // The current handler does not consult this canonical Worker envelope.
      WORKER_ENVELOPES: new Map([["worker-env-real-handler", { status: "Stored" }]])
    }),
    writes, audits, reads
  };
}

test("RED expected: a Completed Firebase mirror cannot authorize approval when Worker envelope is not Completed", async () => {
  const harness = approvalHarness({ mirrorStatus: "Completed" });
  const response = await harness.call();
  const body = await response.json();
  // Expected RED on the current head: handler returns 200 because it checks only
  // signatureEnvelopes/{id}, not envelopes/{gatewayEnvelopeId}.
  assert.equal(response.status, 409, "approval must reject a mirror-only Completed status when the Worker envelope is incomplete");
  assert.match(body.error || "", /Worker envelope.*Completed|canonical.*Completed/i);
  assert.equal(harness.writes.length, 0, "a denied decision must not mutate the document");
  assert.equal(harness.audits.length, 0, "a denied decision must not write an approval audit");
});

test("non-officer approval is denied without approval mutation", async () => {
  const harness = approvalHarness({ actorUid: "outsider-1", officer: false });
  const response = await harness.call();
  assert.equal(response.status, 403);
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.audits.length, 0);
});

test("duplicate approval is denied without a second mutation", async () => {
  const harness = approvalHarness({ priorDecision: true });
  const response = await harness.call();
  assert.equal(response.status, 409);
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.audits.length, 0);
});

test.todo("REAL CHAIN: Auth and Firestore emulators; identity/profile fixtures only; upload via real client and Worker handlers and verify byte/hash linkage");
test.todo("REAL CHAIN: run real createSignatureEnvelope/startSignatureWorkflow client functions via Vite SSR and an in-process authenticated Worker fetch adapter; no hand-written envelope/document records");
test.todo("REAL CHAIN: sign as two Auth emulator users through real Worker signing handlers and client functions; verify sequential and parallel completion without hand-written Completed mirror");
test.todo("REAL CHAIN: mirror Completed while canonical Worker envelope is incomplete is denied through the real approval HTTP route");
test.todo("REAL CHAIN: a different PDF than the uploaded PDF is signed; approval is denied by recomputed source-hash mismatch");
test.todo("REAL CHAIN: partial required-signer completion is denied");
test.todo("REAL CHAIN: distinct authorization officer approves fully signed, hash-bound document");
test.todo("REAL CHAIN: signer self-approval is denied with non-mutating denial audit");
test.todo("REAL CHAIN: duplicate approval is denied with emulator state created through the real handler and denial audit");
test.todo("REAL CHAIN: every denial is non-mutating and audited; current approval handler only audits successful decisions");
