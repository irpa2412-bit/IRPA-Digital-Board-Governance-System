import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loader = readFileSync("public/dashboard-hero-fix.js", "utf8");
const stylesheet = readFileSync("public/dashboard-hero-fix.css", "utf8");

test("dashboard hero loader references the dedicated scoped stylesheet", () => {
  assert.match(loader, /dashboard-hero-fix\.css\?v=20261012/);
  assert.match(loader, /data-irpa-hero/);
  assert.doesNotMatch(loader, /createElement\(['"]style['"]\)/);
});

test("dashboard hero stylesheet contains the required weather and access hooks", () => {
  assert.match(stylesheet, /\[data-irpa-hero\]/);
  assert.match(stylesheet, /\[data-irpa-weather\]/);
  assert.match(stylesheet, /\[data-irpa-access\]/);
  assert.match(stylesheet, /@media \(max-width: 900px\)/);
});
