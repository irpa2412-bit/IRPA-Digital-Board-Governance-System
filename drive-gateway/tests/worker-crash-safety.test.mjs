import test from "node:test";
import assert from "node:assert/strict";
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
  assert.match(response.headers.get("content-type") || "", /application\\/json/i);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://irpa-digital-board-governance.web.app");
  const body = await response.json();
  assert.equal(typeof body.error, "string");
  assert.match(body.error, /Route \\/api\\/signature-pathway\\/reconcile failed at step/);
});

test("signature reconciliation is bounded and exposes pagination", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(source, /getFirestoreCollectionDocumentsPage/);
  assert.match(source, /limit: pageSize/);
  assert.match(source, /Reconciliation is limited to 8 documents per request/);
  assert.match(source, /nextPageAfter: autoDiscover \? nextPageAfter : null/);
});

test("all Worker outbound fetches in the main module use the eight-second timeout helper", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(source, /const OUTBOUND_TIMEOUT_MS = 8000/);
  assert.match(source, /async function fetchWithTimeout/);
  assert.ok(!source.replace(/async function fetchWithTimeout[\\s\\S]*?\\n}\\n/, "").match(/\\bfetch\\(/), "no direct outbound fetch calls should bypass fetchWithTimeout");
});
