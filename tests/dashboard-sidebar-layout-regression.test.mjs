import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/styles/app.css", import.meta.url), "utf8");

test("compact desktop keeps the sidebar fixed instead of pushing the main dashboard down", () => {
  assert.match(css, /@media\(max-width:1100px\)\{\.sidebar\{position:fixed;inset:0 auto 0 0;width:180px;min-height:100vh\}/);
  assert.doesNotMatch(css, /@media\(max-width:1100px\)\{\.sidebar\{position:static/);
});

test("the dedicated mobile breakpoint remains present", () => {
  assert.match(css, /@media\(max-width:760px\)/);
});
