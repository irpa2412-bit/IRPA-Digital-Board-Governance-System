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


test("sidebar portal entries are alphabetically re-sorted at render time within each existing group", () => {
  assert.ok(source.includes("sortNavigationItems(items.filter(x=>!PORTAL_CHILDREN_SET.has(x))).map(x=>"));
  assert.ok(source.includes("function sortNavigationItems(items)"));
  assert.ok(source.includes("labelA.localeCompare(labelB,\"en\",{sensitivity:\"base\",numeric:true})"));
});

test("mobile portal navigation derives from the current authorized module registry and registered parent portals", () => {
  assert.ok(source.includes("[...modules,...PORTAL_ROLLER_GROUPS.map(([parent])=>parent)]"));
  assert.ok(source.includes("filter(target=>!PORTAL_CHILDREN_SET.has(target))"));
  assert.ok(source.includes("const portalItems=sortNavigationItems("));
  assert.ok(source.includes("const children=sortNavigationItems((PORTAL_CHILDREN[target]||[]).filter(child=>modules.includes(child)))"));
});

test("alphabetical navigation changes do not alter the registered sub-portal boundary or access-gate handlers", () => {
  assert.ok(source.includes("const PORTAL_CHILDREN_SET=new Set(Object.values(PORTAL_CHILDREN).flat())"));
  assert.ok(source.includes("onClick={()=>requestDataGate(x)}"));
  assert.ok(source.includes("onClick={()=>go(child)}"));
  assert.ok(source.includes("const navigateWithoutDataGate=target=>{if(!target)return;setGateBypassPortal(target);setActive(target)}"));
});

const entry = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const navigationCss = readFileSync(new URL("../src/styles/page-back-next-navigation.css", import.meta.url), "utf8");

test("Back/Next freeze rules are in the stylesheet imported by the production entry point", () => {
  assert.ok(entry.includes('import "./styles/page-back-next-navigation.css";'));
  assert.match(navigationCss, /\.main-area\s*>\s*\.desktop-webapp-navigation-roller\s*\{[\s\S]*?position:\s*sticky\s*!important/);
  assert.match(navigationCss, /\.main-area\s*>\s*\.page-back-next-navigation\s*\{[\s\S]*?position:\s*sticky\s*!important/);
  assert.match(navigationCss, /@media\s*\(max-width:\s*760px\)[\s\S]*?top:\s*calc\(150px\s*\+\s*46px\s*\+\s*8px\s*\+\s*env\(safe-area-inset-top,\s*0px\)\)\s*!important/);
});
