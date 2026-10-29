import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import worker from "../src/index.js";

test("Worker dispatch converts a thrown route error to JSON with CORS, route and step", async () => {
  const request = new Request("https://worker.test/api/signature-pathway/reconcile", {
    method: "POST",
    headers: {
      Authorization: "Bearer invalid-token",
      Origin: "https://irpa-digital-board-governance.web.app",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ dryRun: true, documents: [] })
  });
  const response = await worker.fetch(request, {
    FIREBASE_PROJECT_ID: "irpa-digital-board-governance",
    IRPA_ENVIRONMENT: "production"
  });
  assert.ok(response.status >= 400);
  assert.ok((response.headers.get("content-type") || "").includes("application/json"));
  assert.equal(response.headers.get("access-control-allow-origin"), "https://irpa-digital-board-governance.web.app");
  const body = await response.json();
  assert.equal(typeof body.error, "string");
  assert.ok(body.error.includes("Route /api/signature-pathway/reconcile failed at step"));
  assert.equal(body.route, "/api/signature-pathway/reconcile");
  assert.equal(typeof body.step, "string");
  assert.equal(typeof body.message, "string");
});

test("signature reconciliation is bounded and exposes pagination", async () => {
  const source = await fs.readFile(new URL("../src/index.js", import.meta.url), "utf8");
  assert.ok(source.includes("getFirestoreCollectionDocumentsPage"));
  assert.ok(source.includes("limit: pageSize"));
  assert.ok(source.includes("Reconciliation is limited to 8 documents per request"));
  assert.ok(source.includes("nextPageAfter: autoDiscover ? nextPageAfter : null"));
});

test("all Worker outbound fetches in the main module use the eight-second timeout helper", async () => {
  const source = await fs.readFile(new URL("../src/index.js", import.meta.url), "utf8");
  assert.ok(source.includes("const OUTBOUND_TIMEOUT_MS = 8000"));
  assert.ok(source.includes("async function fetchWithTimeout"));
  const helperStart = source.indexOf("async function fetchWithTimeout");
  const helperEnd = source.indexOf("\n}\n", helperStart) + 3;
  const outsideHelper = source.slice(0, helperStart) + source.slice(helperEnd);
  assert.equal(outsideHelper.includes('fetch("https://'), false);
  assert.equal(outsideHelper.includes("fetch(`https://"), false);
});

test("profile authorization does not add a redundant service-account token exchange", async () => {
  const source = await fs.readFile(new URL("../src/index.js", import.meta.url), "utf8");
  const reconcileStart = source.indexOf("async function reconcileSignatureDocumentIds");
  const reconcileEnd = source.indexOf("\n}\n", reconcileStart);
  const reconcile = source.slice(reconcileStart, reconcileEnd);
  const policyStart = source.indexOf("async function controlledDocumentUploadPolicyCheck");
  const policyEnd = source.indexOf("\n}\n", policyStart);
  const policy = source.slice(policyStart, policyEnd);
  assert.ok(reconcile.includes("getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token)"));
  assert.ok(policy.includes("getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token)"));
  assert.ok(!policy.includes("getFirestoreAdminAccessToken(env)"));
});
