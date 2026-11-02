import test from "node:test";
import assert from "node:assert/strict";
import { describePdfPageError } from "../src/utils/pdfPageRendering.mjs";

test("PDF page errors retain both the error name and message for inline diagnostics", () => {
  const result = describePdfPageError(Object.assign(new Error("canvas allocation failed"), { name: "RenderingError" }));
  assert.deepEqual(result, { name: "RenderingError", message: "canvas allocation failed" });
});

test("PDF page diagnostics never silently erase an unknown error", () => {
  assert.deepEqual(describePdfPageError(null), {
    name: "Error",
    message: "Unknown PDF page rendering error."
  });
});
