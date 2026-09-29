import assert from "node:assert/strict";
import worker from "../src/index.js";

const env = { IRPA_FIREBASE_ORIGIN: "" };

const health = await worker.fetch(new Request("https://baseline.example/health"), env);
assert.equal(health.status, 200);
assert.equal((await health.json()).productionMigration, false);

const unauthenticated = await worker.fetch(new Request("https://baseline.example/api/document/reference", {
  method: "POST",
  headers: { "idempotency-key": "test-1" }
}), env);
assert.equal(unauthenticated.status, 401);
assert.equal((await unauthenticated.json()).code, "AUTHENTICATION_REQUIRED");

const missingIdempotency = await worker.fetch(new Request("https://baseline.example/api/document/save", {
  method: "POST",
  headers: { "authorization": "Bearer firebase-test-token" }
}), env);
assert.equal(missingIdempotency.status, 400);
assert.equal((await missingIdempotency.json()).code, "IDEMPOTENCY_KEY_REQUIRED");

const missingOrigin = await worker.fetch(new Request("https://baseline.example/api/document/reference", {
  method: "POST",
  headers: {
    "authorization": "Bearer firebase-test-token",
    "idempotency-key": "test-2"
  },
  body: JSON.stringify({ operation: "baseline-test" })
}), env);
assert.equal(missingOrigin.status, 503);
assert.equal((await missingOrigin.json()).code, "ROUTING_ORIGIN_NOT_CONFIGURED");

const pdf = btoa("%PDF-1.7\nIRPA TEST");
const transfer = await worker.fetch(new Request("https://baseline.example/api/signature/pdf-transfer", {
  method: "POST",
  headers: {
    "authorization": "Bearer firebase-test-token",
    "idempotency-key": "pdf-test-1",
    "content-type": "application/json"
  },
  body: JSON.stringify({
    documentReference: "IRPA-TEST-00001",
    signerIdentity: "authenticated-test-user",
    signingAuthority: "test-authority",
    pdfBase64: pdf
  })
}), env);
assert.equal(transfer.status, 200);
const transferBody = await transfer.json();
assert.equal(transferBody.pdfValidated, true);
assert.match(transferBody.sha256, /^[a-f0-9]{64}$/);

console.log("Cloudflare routing baseline tests passed.");
