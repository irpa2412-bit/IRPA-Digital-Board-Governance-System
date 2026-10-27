import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settings = readFileSync(new URL("../src/pages/Settings.jsx", import.meta.url), "utf8");
const readiness = readFileSync(new URL("../src/components/ReleaseReadiness.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("Settings exposes a clearly labelled Release Readiness shortcut at the top", () => {
  assert.ok(settings.indexOf('aria-label="Release Readiness shortcut"') < settings.indexOf('{admin && section === "settings" && <DepartmentArchiveRegistry/>'));
  assert.match(settings, /Open Release Readiness/);
  assert.match(settings, /href="#release-readiness"/);
  assert.match(settings, /<ReleaseReadiness admin={admin} \/>/);
});

test("Release Readiness shows an explicit Administrator requirement for other roles", () => {
  assert.match(readiness, /function ReleaseReadiness\(\{ admin = false \}\)/);
  assert.match(readiness, /if \(!admin\)/);
  assert.match(readiness, /Required role: Administrator/);
  assert.match(settings, /id="release-readiness"/);
});

test("the direct hash link selects Settings after authentication and on hash navigation", () => {
  assert.match(app, /window\.location\.hash==="#release-readiness"/);
  assert.match(app, /window\.addEventListener\("hashchange",openReleaseReadiness\)/);
  assert.match(settings, /id="release-readiness"/);
});
