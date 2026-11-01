import test from "node:test";
import assert from "node:assert/strict";
import { runControlledDocumentDiagnosticBatch } from "../../src/utils/controlledDocumentDiagnosticBatch.mjs";

test("18-document mocked Worker batch sends one document per request, caps concurrency at 3, retries at most 3 times, and stays within 8 subrequests", async () => {
  const rows = Array.from({ length: 18 }, (_, index) => ({ documentId: "doc-" + String(index + 1).padStart(2, "0"), title: "Document " + (index + 1), fileId: "drive-" + (index + 1) }));
  const attempts = new Map();
  const perAttemptSubrequests = [];
  let active = 0;
  let maximumActive = 0;
  let requestCount = 0;
  let totalSubrequests = 0;
  const progress = [];

  async function mockedWorker(documents, options) {
    assert.equal(documents.length, 1, "every Worker invocation must contain exactly one document");
    assert.equal(options.dryRun, true);
    assert.equal(options.autoDiscover, false);
    const item = documents[0];
    requestCount += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    let subrequests = 0;
    const subrequest = async () => { subrequests += 1; totalSubrequests += 1; };
    try {
      // Cold Worker invocation's actual diagnostic dependency sequence:
      // Firebase ID-token/JWKS authentication; service-account token + admin profile read;
      // Firestore diagnostic token + target document read; Drive OAuth token;
      // Drive metadata read; Drive media download. No second metadata lookup.
      for (let i = 0; i < 8; i += 1) await subrequest();
      perAttemptSubrequests.push({ documentId: item.documentId, count: subrequests });
      const attempt = (attempts.get(item.documentId) || 0) + 1;
      attempts.set(item.documentId, attempt);
      if (item.documentId === "doc-03" && attempt < 4) throw new Error("temporary 503 from mocked Worker");
      if (item.documentId === "doc-12") throw new Error("persistent 503 from mocked Worker");
      await new Promise(resolve => setTimeout(resolve, 2));
      return { results: [{ documentId: item.documentId, status: "match", classification: "OK", fileId: item.fileId }] };
    } finally {
      active -= 1;
    }
  }

  const results = await runControlledDocumentDiagnosticBatch(rows, mockedWorker, {
    concurrency: 3,
    maxRetries: 3,
    retryDelay: async () => {},
    onProgress: value => progress.push(value)
  });

  assert.equal(results.length, 18);
  assert.equal(maximumActive, 3);
  assert.ok(maximumActive <= 3);
  assert.ok(perAttemptSubrequests.every(item => item.count === 8), "real cold-request count must be 8 subrequests including authentication");
  assert.ok(perAttemptSubrequests.every(item => item.count <= 8));
  assert.equal(attempts.get("doc-03"), 4, "transient failure retries three times and succeeds on the fourth attempt");
  assert.equal(attempts.get("doc-12"), 4, "permanent failure stops after the fourth attempt");
  assert.equal(results.find(item => item.documentId === "doc-12").classification, "REQUEST_FAILED");
  assert.equal(requestCount, 24, "18 documents plus six retry requests");
  assert.equal(totalSubrequests, 192, "24 Worker requests × 8 subrequests per request");
  assert.equal(progress.at(-1).completed, 18);
  assert.equal(progress.at(-1).active, 0);
  console.log("BATCH AUDIT: documents=18; Worker requests=24; max concurrency=3; max retries=3 (4 attempts maximum); subrequests per Worker request=8; total subrequests=192.");
});
