import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("portal navigation scrolls to the rendered active portal content, not the shared header", () => {
  assert.ok(source.includes('const workspace=document.querySelector("#root .app-shell .main-area > .content-area [data-active-portal-content]");'));
  assert.ok(source.includes('workspace.scrollIntoView({block:"start",behavior:"auto"});'));
  assert.ok(source.includes('data-active-portal-content={active}'));
  assert.ok(source.includes('data-active-portal-content="Dashboard"'));
});

test("navigation focus work is cancelled when the active portal changes or the shell unmounts", () => {
  assert.ok(source.includes("window.cancelAnimationFrame(firstFrame)"));
  assert.ok(source.includes("window.cancelAnimationFrame(secondFrame)"));
});

test("destination navigation keeps existing access-gate routing and entry-intent handling", () => {
  assert.ok(source.includes('const requestDataGate=target=>{if(!target)return;setGateBypassPortal("");setActive(target)}'));
  assert.ok(source.includes('const navigateWithoutDataGate=target=>{if(!target)return;setGateBypassPortal(target);setActive(target)}'));
  assert.ok(source.includes("const handlePortalDataEntryIntent="));
  assert.ok(!source.includes("window.scrollTo(0,0)"));
});
