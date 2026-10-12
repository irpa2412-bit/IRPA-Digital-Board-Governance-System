import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("health endpoint exposes service identity without credentials", async () => {
  const response = await worker.fetch(new Request("https://crawler.example.workers.dev/health"), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.project, "irpa-digital-board-governance");
  assert.equal(body.sourceCount, 15);
  assert.ok(body.capabilities.includes("opportunities"));
  assert.ok(body.capabilities.includes("saved_drafts"));
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

test("opportunity retrieval requires a valid Firebase ID token", async () => {
  const response = await worker.fetch(new Request("https://crawler.example.workers.dev/opportunities"), {});
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Authentication required/);
});

test("draft listing and saving reject unauthenticated requests", async () => {
  const list = await worker.fetch(new Request("https://crawler.example.workers.dev/application/drafts"), {});
  assert.equal(list.status, 401);
  const save = await worker.fetch(new Request("https://crawler.example.workers.dev/application/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "test-draft", name: "Unauthorized draft" })
  }), {});
  assert.equal(save.status, 401);
});

test("draft audit trail rejects unauthenticated requests", async () => {
  const response = await worker.fetch(new Request("https://crawler.example.workers.dev/application/drafts/test-draft/events"), {});
  assert.equal(response.status, 401);
});
