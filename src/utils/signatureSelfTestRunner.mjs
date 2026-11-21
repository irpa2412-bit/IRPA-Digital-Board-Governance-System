export const SELF_TEST_CHUNK_SIZE = 20;
export const SELF_TEST_PER_DOCUMENT_TIMEOUT_MS = 15_000;
export const SELF_TEST_TOTAL_TIMEOUT_MS = 60_000;

export class SelfTestCancelledError extends Error {
  constructor() { super("Self-test cancelled."); this.name = "AbortError"; this.code = "CANCELLED"; }
}
export class SelfTestTimeoutError extends Error {
  constructor(scope) { super(scope === "total" ? "The 60-second self-test time limit was reached." : "This document exceeded the 15-second self-test limit."); this.name = "TimeoutError"; this.code = scope === "total" ? "TOTAL_TIMEOUT" : "DOCUMENT_TIMEOUT"; this.scope = scope; }
}

export async function runBoundedSelfTestChunk(documents, processDocument, {
  signal,
  onProgress = () => {},
  perDocumentTimeoutMs = SELF_TEST_PER_DOCUMENT_TIMEOUT_MS,
  totalTimeoutMs = SELF_TEST_TOTAL_TIMEOUT_MS,
  now = () => Date.now()
} = {}) {
  const startedAt = now();
  const output = [];
  for (let index = 0; index < Math.min(documents.length, SELF_TEST_CHUNK_SIZE); index += 1) {
    if (signal?.aborted) throw new SelfTestCancelledError();
    const remaining = totalTimeoutMs - (now() - startedAt);
    if (remaining <= 0) break;
    const controller = new AbortController();
    const abortParent = () => controller.abort();
    signal?.addEventListener("abort", abortParent, { once: true });
    const timeoutMs = Math.max(1, Math.min(perDocumentTimeoutMs, remaining));
    let timer;
    try {
      const work = Promise.resolve().then(() => processDocument(documents[index], { signal: controller.signal }));
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new SelfTestTimeoutError(timeoutMs < perDocumentTimeoutMs ? "total" : "document"));
        }, timeoutMs);
      });
      const value = await Promise.race([work, timeout]);
      output.push({ ok: true, value });
    } catch (error) {
      if (signal?.aborted) throw new SelfTestCancelledError();
      output.push({ ok: false, error: { code: error?.code || "DOCUMENT_FAILED", message: String(error?.message || "Document check failed.").slice(0, 240) } });
      if (error?.code === "TOTAL_TIMEOUT") break;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortParent);
      controller.abort();
    }
    onProgress({ completed: output.length, total: Math.min(documents.length, SELF_TEST_CHUNK_SIZE), active: 0 });
    if (now() - startedAt >= totalTimeoutMs) break;
  }
  return { results: output, timedOut: now() - startedAt >= totalTimeoutMs };
}
