import test from "node:test";
import assert from "node:assert/strict";
import { runSequentialSelfTestBatch } from "../src/utils/signatureSelfTestBatch.mjs";

test("500 mocked documents are processed in pages of 20 with strict concurrency one", async () => {
  const documents = Array.from({ length: 500 }, (_, index) => ({ id: "mock-" + index }));
  const completed = [];
  let active = 0;
  let maxActive = 0;
  for (let offset = 0; offset < documents.length; offset += 20) {
    const batch = await runSequentialSelfTestBatch(documents.slice(offset, offset + 20), async document => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      completed.push(document.id);
      active -= 1;
      return { ok: true, id: document.id };
    });
    assert.equal(batch.results.length, 20);
    assert.equal(batch.cancelled, false);
    assert.equal(batch.timedOut, false);
  }
  assert.equal(completed.length, 500);
  assert.equal(new Set(completed).size, 500);
  assert.equal(maxActive, 1);
});

test("one document timeout aborts that document and processing continues", async () => {
  const docs = [{ id: "slow" }, { id: "next" }];
  const batch = await runSequentialSelfTestBatch(docs, async (document, signal) => {
    if (document.id === "slow") {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 50);
        signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
      });
    }
    return document.id;
  }, { perDocumentTimeoutMs: 10, totalTimeoutMs: 1000 });
  assert.match(batch.results[0].error, /timed out/);
  assert.equal(batch.results[1].result, "next");
});

test("cancellation stops before the next document", async () => {
  const controller = new AbortController();
  const docs = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const batch = await runSequentialSelfTestBatch(docs, async document => {
    controller.abort();
    return document.id;
  }, { signal: controller.signal });
  assert.equal(batch.results.length, 1);
  assert.equal(batch.cancelled, true);
});
