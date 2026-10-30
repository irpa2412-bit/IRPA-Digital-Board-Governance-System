import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const root = JSON.parse(read("package.json"));
const desktop = JSON.parse(read("desktop/package.json"));
const web = read(".github/workflows/offline-install-validation.yml");
const windows = read(".github/workflows/build-desktop.yml");
const android = read(".github/workflows/android-apk.yml");
const promotion = read(".github/workflows/production-promotion-gate.yml");

test("root application dependency manifests remain free of desktop toolchain", () => {
  assert.ok(existsSync("package-lock.json"));
  assert.equal(root.devDependencies?.electron, undefined);
  assert.equal(root.devDependencies?.["electron-builder"], undefined);
  assert.equal(root.dependencies?.electron, undefined);
  assert.equal(root.dependencies?.["electron-builder"], undefined);
});

test("Windows toolchain is isolated in desktop package", () => {
  assert.equal(desktop.devDependencies.electron, "38.2.0");
  assert.equal(desktop.devDependencies["electron-builder"], "26.0.12");
  assert.match(windows, /npm install --no-audit --no-fund/);
  assert.match(windows, /npm ci --prefix desktop/);
  assert.match(windows, /electron-builder\.cmd/);
  assert.match(windows, /--publish never/);
  assert.doesNotMatch(windows, /firebase deploy|wrangler deploy/i);
});

test("Android wrapper uses the locked root Capacitor dependencies", () => {
  assert.match(android, /npm ci --no-audit --no-fund/);
  assert.match(android, /npx cap add android && npx cap sync android/);
  assert.match(android, /assembleDebug/);
  assert.match(android, /upload-artifact/);
  assert.doesNotMatch(android, /firebase deploy|wrangler deploy|publish/i);
  assert.equal(existsSync("android/package.json"), false);
});

test("web validation is independent and uses the root lock", () => {
  assert.match(web, /npm ci --no-audit --no-fund/);
  assert.match(web, /npm run build/);
  assert.match(web, /test:offline-pwa|pwa-install-offline/);
  assert.doesNotMatch(web, /desktop\/|electron\/|android\//);
});

test("production promotion gate does not depend on desktop or Android wrappers", () => {
  assert.match(promotion, /npm ci --no-audit --no-fund/);
  assert.match(promotion, /npm run build/);
  assert.doesNotMatch(promotion, /desktop\/|electron\/|android\//);
  assert.doesNotMatch(promotion, /electron-builder|assembleDebug/);
});
