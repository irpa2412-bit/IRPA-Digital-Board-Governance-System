import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const selfTest = await readFile(new URL("../src/components/SignaturePathwaySelfTest.jsx", import.meta.url), "utf8");
const page = await readFile(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
const boundary = await readFile(new URL("../src/components/SignaturePathwaySelfTestErrorBoundary.jsx", import.meta.url), "utf8");
const startup = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

test("self-test panel is isolated by an error boundary", () => {
  assert.match(page, /SignaturePathwaySelfTestErrorBoundary><SignaturePathwaySelfTest\/>/);
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /SELF_TEST_PANEL_ERROR/);
});

test("self-test reads bounded Firestore pages and never reads the full documents collection", () => {
  assert.match(selfTest, /orderBy\(documentId\(\)\)/);
  assert.match(selfTest, /limit\(20\)/);
  assert.match(selfTest, /startAfter\(cursor\)/);
  assert.doesNotMatch(selfTest, /getDocs\(collection\(db,\s*["']documents["']\)\)/);
  assert.match(selfTest, /Run next 20/);
});

test("self-test is sequential, cancellable and enforces 15-second and 60-second limits", () => {
  assert.match(selfTest, /runSequentialSelfTestBatch/);
  assert.match(selfTest, /perDocumentTimeoutMs:\s*15000/);
  assert.match(selfTest, /totalTimeoutMs:\s*60000/);
  assert.match(selfTest, /onClick=\{cancelReconcile\}/);
  assert.match(selfTest, /runAbort\.current\?\.abort\(\)/);
});

test("only the first PDF page is rendered and per-document memory is released", () => {
  assert.match(selfTest, /renderPdfPageToCanvas\(pdf,\s*1,/);
  assert.doesNotMatch(selfTest, /for\s*\(let pageNumber\s*=\s*1/);
  assert.match(selfTest, /await pdf\.destroy\(\)/);
  assert.match(selfTest, /bytes\.fill\(0\)/);
  assert.match(selfTest, /canvas\.width = 1; canvas\.height = 1; canvas\.remove\(\)/);
});

test("all self-test Gateway JSON is shape-validated, bounded and sanitised", () => {
  assert.match(selfTest, /sanitizeGatewayValue/);
  assert.match(selfTest, /Array\.isArray\(raw\)/);
  assert.match(selfTest, /response\.results\.length !== 1/);
  assert.match(selfTest, /slice\(0, 2000\)/);
  assert.match(selfTest, /redirect: "error"/);
});

test("self-test diagnostics are memory-only and legacy saved results are cleared on mount", () => {
  assert.doesNotMatch(selfTest, /(?:localStorage|sessionStorage)\.setItem/);
  assert.match(selfTest, /clearSavedSelfTestData\(\)/);
  assert.match(selfTest, /storage\.removeItem\(key\)/);
});
