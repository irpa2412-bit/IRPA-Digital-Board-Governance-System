import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("portal changes focus the viewport on the destination workspace", () => {
  assert.ok(source.includes('const workspace=document.querySelector("#root .app-shell .main-area > .content-area #portal-workspace-content")'));
  assert.ok(source.includes('ancestor.scrollTop+=rect.top-16'));
  assert.ok(source.includes('window.scrollBy({top:rect.top-16,left:0,behavior:"auto"})'));
  assert.ok(source.includes('},[active,user?.uid,sessionAdministrator]);'));
});

test("portal changes scroll to and focus the actual portal body below navigation controls", () => {
  assert.match(source, /workspace\.focus\(\{preventScroll:true\}\)/);
  assert.ok(source.includes('<div id="portal-workspace-content" className="portal-workspace-content" tabIndex={-1}>'));
  assert.ok(source.includes('</EmployeePayments></div></main>') || source.includes('/>}</div></main>'));
});

test("navigation focus is scoped to the main workspace, not the global header", () => {
  assert.match(source, /#root \.app-shell \.main-area > \.content-area #portal-workspace-content/);
  assert.doesNotMatch(source, /window\.scrollTo\(\s*0\s*,\s*0\s*\)/);
});

test("scheduled viewport work is cancelled when the active portal changes or the shell unmounts", () => {
  assert.match(source, /window\.cancelAnimationFrame\(firstFrame\)/);
  assert.match(source, /window\.cancelAnimationFrame\(secondFrame\)/);
  assert.ok(source.includes('return()=>{\n    window.cancelAnimationFrame(firstFrame);\n    window.cancelAnimationFrame(secondFrame);\n  };'));
});

test("navigation repair remains presentation-only and leaves access-gate routing in place", () => {
  assert.match(source, /const requestDataGate=target=>\{if\(!target\)return;setGateBypassPortal\(""\);setActive\(target\)\}/);
  assert.match(source, /const navigateWithoutDataGate=target=>\{if\(!target\)return;setGateBypassPortal\(target\);setActive\(target\)\}/);
  assert.match(source, /const handlePortalDataEntryIntent=/);
});
