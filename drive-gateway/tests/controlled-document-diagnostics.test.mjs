import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseControlledDocument } from "../src/controlledDocumentDiagnostics.mjs";

const item = { title: "Board Minutes", documentId: "doc-1", fileId: "drive-1" };
const pdf = new Uint8Array([37,80,68,70,45,49,46,55,10,37,226,227,207,211,10]);
const validPdf = async () => {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.addPage();
  return new Uint8Array(await doc.save());
};
const run = (overrides = {}) => diagnoseControlledDocument({
  item,
  record: { size: 15, sha256: "expected", pageCount: 1, uploadedBy: "records@irpa.or.tz", uploadedAt: "2026-01-01T00:00:00Z", ...overrides.record },
  getMetadata: overrides.getMetadata || (async () => ({ mimeType: "application/pdf", size: 15, trashed: false, parents: ["folder-1"], createdTime: "2026-01-01T00:00:00Z" })),
  downloadBytes: overrides.downloadBytes || (async () => pdf)
});
test("FILE_MISSING reports notFound and metadata step", async () => {
 const r = await run({ getMetadata: async () => { const e = new Error("File not found"); e.status = 404; throw e; } });
 assert.equal(r.classification, "FILE_MISSING"); assert.match(r.reason, /File not found/); assert.equal(r.step, "Drive metadata call");
});
test("NO_ACCESS reports forbidden and content step", async () => {
 const r = await run({ downloadBytes: async () => { const e = new Error("Not shared with service account"); e.status = 403; throw e; } });
 assert.equal(r.classification, "NO_ACCESS"); assert.match(r.reason, /Not shared with service account/); assert.equal(r.driveErrorReason, "forbidden");
});
test("HASH_MISMATCH reports hash reason and PDF page comparison", async () => {
 const bytes = await validPdf();
 const r = await diagnoseControlledDocument({ item, record: { size: bytes.length, sha256: "bad-hash", pageCount: 3 }, getMetadata: async () => ({ mimeType: "application/pdf", size: bytes.length }), downloadBytes: async () => bytes });
 assert.equal(r.classification, "HASH_MISMATCH"); assert.match(r.reason, /SHA-256 differs/); assert.match(r.pageCountComparison, /PDF parses: yes; pages: 1; stored at upload: 3/);
});
test("SIZE_MISMATCH reports byte-count reason and PDF page comparison", async () => {
 const bytes = await validPdf();
 const r = await diagnoseControlledDocument({ item, record: { size: bytes.length + 4, sha256: "", pageCount: 2 }, getMetadata: async () => ({ mimeType: "application/pdf", size: bytes.length }), downloadBytes: async () => bytes });
 assert.equal(r.classification, "SIZE_MISMATCH"); assert.match(r.reason, /byte count/); assert.match(r.pageCountComparison, /pages: 1; stored at upload: 2/);
});
test("NOT_A_PDF reports actual MIME type and reason", async () => {
 const r = await run({ getMetadata: async () => ({ mimeType: "text/plain", size: 4 }), downloadBytes: async () => new Uint8Array([65,66,67,68]) });
 assert.equal(r.classification, "NOT_A_PDF"); assert.match(r.reason, /text\/plain/);
});
test("PDF_PARSE_FAILED reports parser failure", async () => {
 const r = await run({ getMetadata: async () => ({ mimeType: "application/pdf", size: 15 }), downloadBytes: async () => new Uint8Array([37,80,68,70,45,49,46,55,10]) });
 assert.equal(r.classification, "PDF_PARSE_FAILED"); assert.match(r.reason, /PDF parsing failed/);
});
test("TRANSIENT retries three times before final classification", async () => {
 let calls = 0;
 const r = await run({ getMetadata: async () => { calls++; const e = new Error("Rate limit exceeded"); e.status = 429; throw e; } });
 assert.equal(r.classification, "TRANSIENT"); assert.equal(calls, 4); assert.match(r.reason, /Rate limit exceeded/);
});
test("UNKNOWN preserves unexpected failure reason", async () => {
 const r = await run({ getMetadata: async () => { throw new Error("Unexpected gateway failure"); } });
 assert.equal(r.classification, "UNKNOWN"); assert.match(r.reason, /Unexpected gateway failure/);
});
