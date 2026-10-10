import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("health endpoint exposes service identity without credentials", async () => {
  const response = await worker.fetch(new Request("https://crawler.example.workers.dev/health"), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.project, "irpa-digital-board-governance");
  assert.equal(body.sourceCount, 11);
});

test("manual scan rejects unauthenticated requests", async () => {
  const response = await worker.fetch(new Request("https://crawler.example.workers.dev/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  }), {});
  assert.equal(response.status, 401);
});

test("unknown routes are rejected", async () => {
  const response = await worker.fetch(new Request("https://crawler.example.workers.dev/anything"), {});
  assert.equal(response.status, 404);
});

test("CORS does not grant arbitrary origins", async () => {
  const response = await worker.fetch(new Request("https://crawler.example.workers.dev/health", {
    headers: { Origin: "https://attacker.invalid" }
  }), {});
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});
