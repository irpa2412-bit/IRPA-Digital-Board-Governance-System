export async function runSequentialSelfTestBatch(documents, processDocument, {
  signal,
  perDocumentTimeoutMs = 15000,
  totalTimeoutMs = 60000,
  startedAt = Date.now(),
  onProgress = () => {}
} = {}) {
  const batch = Array.isArray(documents) ? documents.slice(0, 20) : [];
  const results = [];
  for (let index = 0; index < batch.length; index += 1) {
    if (signal?.aborted || Date.now() - startedAt >= totalTimeoutMs) break;
    const document = batch[index];
    const remaining = totalTimeoutMs - (Date.now() - startedAt);
    const timeoutMs = Math.max(1, Math.min(perDocumentTimeoutMs, remaining));
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    signal?.addEventListener("abort", abortFromParent, { once: true });
    let timer;
    let rejectOnCancel;
    const cancelled = new Promise((_, reject) => { rejectOnCancel = reject; });
    const cancelListener = () => { controller.abort(); rejectOnCancel(new Error("Self-test cancelled by administrator.")); };
    signal?.addEventListener("abort", cancelListener, { once: true });
    try {
      const work = Promise.resolve().then(() => processDocument(document, controller.signal));
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(timeoutMs >= perDocumentTimeoutMs
            ? "Document diagnostic timed out after 15 seconds."
            : "Self-test run reached its 60-second limit."));
        }, timeoutMs);
      });
      results.push({ document, result: await Promise.race([work, timeout, cancelled]) });
    } catch (error) {
      results.push({ document, error: String(error?.message || "Diagnostic failed").slice(0, 300) });
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromParent);
      signal?.removeEventListener("abort", cancelListener);
      controller.abort();
      onProgress({ completed: index + 1, total: batch.length, active: 0 });
    }
  }
  return {
    results,
    elapsedMs: Date.now() - startedAt,
    cancelled: Boolean(signal?.aborted),
    timedOut: Date.now() - startedAt >= totalTimeoutMs
  };
}
