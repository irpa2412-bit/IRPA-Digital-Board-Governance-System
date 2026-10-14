import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("portal changes focus the viewport on the destination workspace", () => {
  assert.match(
    source,
    /useEffect\(\(\)=>\{\s*let firstFrame=0;\s*let secondFrame=0;[\s\S]*?const workspace=document.querySelector("#root .app-shell .main-area > .content-area \\[data-active-portal-content\\]");[\s\S]*?workspace\.scrollIntoView\(\{block:"start",behavior:"auto"\}\);[\s\S]*?\},\[active\]\);/
  );
});

test("navigation focus is scoped to the main workspace, not the global header", () => {
  assert.match(source, /#root \.app-shell \.main-area > \.content-area \[data-active-portal-content\]/);\n  assert.match(source, /data-active-portal-content=\{active\}/);
  assert.doesNotMatch(source, /window\.scrollTo\(\s*0\s*,\s*0\s*\)/);
});

test("scheduled viewport work is cancelled when the active portal changes or the shell unmounts", () => {
  assert.match(source, /window\.cancelAnimationFrame\(firstFrame\)/);
  assert.match(source, /window\.cancelAnimationFrame\(secondFrame\)/);
  assert.match(source, /return\(\)=>\{\s*window\.cancelAnimationFrame\(firstFrame\);\s*window\.cancelAnimationFrame\(secondFrame\);\s*\};[\s\S]*?\},\[active\]\);/);
});

test("navigation repair remains presentation-only and leaves access-gate routing in place", () => {
  assert.match(source, /const requestDataGate=target=>\{if\(!target\)return;setGateBypassPortal\(""\);setActive\(target\)\}/);
  assert.match(source, /const navigateWithoutDataGate=target=>\{if\(!target\)return;setGateBypassPortal\(target\);setActive\(target\)\}/);
  assert.match(source, /const handlePortalDataEntryIntent=/);
});
