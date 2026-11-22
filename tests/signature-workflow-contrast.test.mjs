import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/styles/workflow.css", import.meta.url), "utf8");
const entry = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");

test("Signature Portal workflow ladder and signer hierarchy use theme-aware accessible contrast", () => {
  assert.match(page, /className="signature-workflow-ladder"/);
  assert.match(page, /className="signature-workflow-ladder-entry"/);
  assert.match(page, /className="signature-workflow-ladder-selected"/);
  assert.match(page, /signature-workflow-hierarchy/);
  assert.match(page, /className="signature-workflow-hierarchy-entry"/);
  assert.match(styles, /\.signature-workflow-ladder[\s\S]*?color:\s*var\(--text\)/);
  assert.match(styles, /background:\s*var\(--surface\)/);
  assert.match(styles, /border:\s*1px solid var\(--border\)/);
  assert.match(styles, /\.signature-workflow-ladder-selected[\s\S]*?background:\s*var\(--surface-raised, var\(--surface\)\)/);
  assert.match(styles, /\.signature-workflow-hierarchy strong[\s\S]*?color:\s*var\(--text\)/);
  assert.match(entry, /import "\.\/styles\/workflow\.css";/);
});
