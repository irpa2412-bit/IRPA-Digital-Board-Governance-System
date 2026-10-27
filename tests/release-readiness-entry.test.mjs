import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
test("persistent build stamp is present outside the authenticated React app", () => {
 const html=read("../index.html");
 assert.match(html,/id="irpa-build-stamp"/);
 assert.match(html,/irpa-build-version/);
 assert.match(html,/irpa-build-time/);
});
test("Settings exposes Release Readiness and a clear Administrator role message", () => {
 const settings=read("../src/pages/Settings.jsx");
 assert.match(settings,/Release Readiness/);
 assert.match(settings,/Required role: Administrator/);
 assert.match(settings,/release-readiness/);
});
test("service worker cache version changes and accepts update activation", () => {
 const sw=read("../public/sw.js");
 assert.match(sw,/irpa-dbgs-app-shell-v45/);
 assert.match(sw,/SKIP_WAITING/);
});
test("update banner provides requested text and refresh wiring", () => {
 const html=read("../index.html"), main=read("../src/main.jsx");
 assert.match(html,/New version available, tap to reload/);
 assert.match(main,/registration\.update\(\)/);
});
