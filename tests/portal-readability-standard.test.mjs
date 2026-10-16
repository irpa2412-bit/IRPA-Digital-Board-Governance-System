import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../src/styles/portal-readability-standard.css", import.meta.url), "utf8");
const entry = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test("shared readability stylesheet is loaded by the application entry point", () => {
  assert.match(entry, /\.\/styles\/portal-readability-standard\.css/);
});
test("standard is scoped to authenticated non-dashboard portal workspaces", () => {
  assert.match(css, /\.content-area:not\(\.dashboard-content-area\)/);
  assert.match(css, /presentation only/i);
});
test("primary text, muted text, form text and placeholders meet WCAG AA on light workspace surfaces", () => {
  const pairs = [
    ["#26352f", "#f8faf9"],
    ["#526b60", "#f8faf9"],
    ["#18364f", "#ffffff"],
    ["#526579", "#ffffff"],
    ["#ffffff", "#0b5fa8"],
    ["#40584d", "#edf4f0"]
  ];
  for (const [foreground, background] of pairs) {
    assert.ok(contrast(foreground, background) >= 4.5, `${foreground} on ${background} must be at least 4.5:1`);
  }
});
test("registers, controls and focus states have explicit readability treatment", () => {
  for (const pattern of [
    /table th\s*\{/,
    /table td\s*\{/,
    /::placeholder/,
    /:focus-visible/,
    /font-size:\s*13px/,
    /font-size:\s*14px/,
    /font-size:\s*15px/
  ]) assert.match(css, pattern);
});
test("shared standard does not change authorization, routing, data or workflow logic", () => {
  assert.doesNotMatch(css, /firebase|firestore|localStorage|sessionStorage|onClick|onSubmit/i);
  assert.doesNotMatch(css, /display\s*:\s*none|visibility\s*:\s*hidden|pointer-events\s*:\s*none/i);
});
