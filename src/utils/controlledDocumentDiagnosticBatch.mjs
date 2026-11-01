export async function runControlledDocumentDiagnosticBatch(rows, requestDocument, {
  concurrency = 3,
  maxRetries = 3,
  retryDelay = attempt => 350 * attempt,
  onProgress = () => {}
} = {}) {
  if (!Array.isArray(rows)) throw new Error("Diagnostic rows must be an array.");
  if (typeof requestDocument !== "function") throw new Error("A Worker request function is required.");
  const limit = Math.max(1, Math.min(3, Number(concurrency) || 3));
  const retriesLimit = Math.max(0, Math.min(3, Number(maxRetries) || 0));
  const attemptsLimit = retriesLimit + 1;
  const output = new Array(rows.length);
  let nextIndex = 0;
  let active = 0;
  let completed = 0;
  const publish = () => onProgress({ completed, total: rows.length, active });
  publish();

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= rows.length) return;
      const item = rows[index];
      active += 1;
      publish();
      let result;
      let lastError;
      for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
        try {
          const response = await requestDocument([item], { dryRun: true, autoDiscover: false });
          if (!response || !Array.isArray(response.results) || response.results.length !== 1) {
            throw new Error("Worker must return exactly one result for " + (item.documentId || item.id || "the requested document") + ".");
          }
          result = response.results[0];
          break;
        } catch (error) {
          lastError = error;
          if (attempt < attemptsLimit) await retryDelay(attempt);
        }
      }
      if (!result) {
        result = {
          documentId: item.documentId || item.id || "",
          title: item.title || item.fileName || item.reference || item.documentId || item.id || "",
          fileId: item.fileId || item.driveFileId || item.archiveFileId || "",
          status: "unreadable",
          classification: "REQUEST_FAILED",
          step: "Worker request",
          attempts: attemptsLimit,
          reason: "Worker request failed after " + retriesLimit + " retries (" + attemptsLimit + " attempts): " + (lastError?.message || "Unknown gateway error")
        };
      }
      output[index] = result;
      active -= 1;
      completed += 1;
      publish();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, () => worker()));
  return output;
}
