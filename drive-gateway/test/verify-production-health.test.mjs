import test from "node:test";
import assert from "node:assert/strict";
import { verifyHealth } from "../scripts/verify-production-health.mjs";

const good = () => new Response(JSON.stringify({
  ok: true,
  storageProvider: "Google Drive",
  commit: "new-commit",
}), { status: 200, headers: { "content-type": "application/json" } });
const stale = () => new Response(JSON.stringify({
  ok: true,
  storageProvider: "Google Drive",
  commit: "old-commit",
}), { status: 200, headers: { "content-type": "application/json" } });

test("retries stale health commit and succeeds when the new Worker propagates", async () => {
  let calls = 0;
  let slept = 0;
  const result = await verifyHealth({
    expectedCommit: "new-commit",
    timeoutMs: 180_000,
    intervalMs: 5_000,
    fetchImpl: async () => (++calls < 3 ? stale() : good()),
    sleepImpl: async (ms) => { slept += ms; },
    now: () => slept,
    onAttempt: () => {},
  });
  assert.equal(calls, 3);
  assert.equal(result.attempts, 3);
  assert.equal(result.commit, "new-commit");
  assert.equal(slept, 10_000);
});

test("fails only after the retry window is exhausted", async () => {
  let calls = 0;
  let clock = 0;
  await assert.rejects(() => verifyHealth({
    expectedCommit: "new-commit",
    timeoutMs: 12_000,
    intervalMs: 5_000,
    fetchImpl: async () => { calls += 1; return stale(); },
    sleepImpl: async (ms) => { clock += ms; },
    now: () => clock,
    onAttempt: () => {},
  }), /failed after 4 attempts over 12000ms/);
  assert.equal(calls, 4);
});
