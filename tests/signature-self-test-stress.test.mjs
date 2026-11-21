import test from "node:test";
import assert from "node:assert/strict";
import { runBoundedSelfTestChunk, SELF_TEST_CHUNK_SIZE, SELF_TEST_PER_DOCUMENT_TIMEOUT_MS, SELF_TEST_TOTAL_TIMEOUT_MS } from "../src/utils/signatureSelfTestRunner.mjs";

test("self-test processes at most 20 documents sequentially", async () => {
  const seen = [];
  let active = 0;
  let maxActive = 0;
  const docs = Array.from({ length: 500 }, (_, index) => ({ id: index }));
  const result = await runBoundedSelfTestChunk(docs, async doc => {
    active += 1; maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    seen.push(doc.id); active -= 1;
    return doc.id;
  });
  assert.equal(SELF_TEST_CHUNK_SIZE, 20);
  assert.equal(result.results.length, 20);
  assert.deepEqual(seen, Array.from({ length: 20 }, (_, index) => index));
  assert.equal(maxActive, 1);
});

test("self-test enforces the 15 second per-document timeout and abort signal", async () => {
  let aborted = false;
  const result = await runBoundedSelfTestChunk([{ id: 1 }], (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
  }), { perDocumentTimeoutMs: 15, totalTimeoutMs: 60 });
  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[0].error.code, "DOCUMENT_TIMEOUT");
  assert.equal(aborted, true);
  assert.equal(SELF_TEST_PER_DOCUMENT_TIMEOUT_MS, 15_000);
  assert.equal(SELF_TEST_TOTAL_TIMEOUT_MS, 60_000);
});

test("self-test cancellation stops before processing another document", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(runBoundedSelfTestChunk([{ id: 1 }, { id: 2 }], async () => {
    calls += 1; controller.abort(); return "done";
  }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 1);
});
