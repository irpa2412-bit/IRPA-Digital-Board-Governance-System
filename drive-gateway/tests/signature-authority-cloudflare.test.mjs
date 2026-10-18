import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("signer authority endpoint rejects unauthenticated requests", async () => {
  const response = await worker.fetch(new Request("https://gateway.test/api/signature/authority/update", {
    method: "POST",
    headers: { "content-type": "application/json", "origin": "https://irpa-digital-board-governance-frontend.irpa-governance.workers.dev" },
    body: JSON.stringify({ authorityRole: "Board Member", authorityStatus: "Current" })
  }), { FIREBASE_PROJECT_ID: "irpa-digital-board-governance" });
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /authentication/i);
});
