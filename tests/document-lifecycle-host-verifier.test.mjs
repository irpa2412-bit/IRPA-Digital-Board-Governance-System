import test from "node:test";
import assert from "node:assert/strict";
import { verifyHostAssets } from "../scripts/verify-document-lifecycle-host.mjs";
import crypto from "node:crypto";

const bytes = value => new TextEncoder().encode(value);
const hash = value => crypto.createHash("sha256").update(bytes(value)).digest("hex");
const manifest = {
  schemaVersion: 1,
  files: {
    "assets/index-entry.js": { sha256: hash('import("./DocumentLifecycleModule-abc.js");'), size: 42 },
    "assets/DocumentLifecycleModule-abc.js": { sha256: hash('import "./dependency.js";'), size: 30 },
    "assets/dependency.js": { sha256: hash("export const ok=true;"), size: 21 }
  }
};
const html = '<html><script type="module" src="/assets/index-entry.js"></script></html>';
const bodies = {
  "/": html,
  "/assets/index-entry.js": 'import("./DocumentLifecycleModule-abc.js");',
  "/assets/DocumentLifecycleModule-abc.js": 'import "./dependency.js";',
  "/assets/dependency.js": "export const ok=true;"
};
const fetcher = overrides => async input => {
  const pathname = new URL(input).pathname;
  if (Object.hasOwn(overrides, pathname)) return new Response(overrides[pathname], { status: overrides[pathname] === null ? 404 : 200 });
  return new Response(bodies[pathname] ?? null, { status: bodies[pathname] ? 200 : 404 });
};

test("tampered DocumentLifecycleModule fails strict per-host manifest hash check (a)", async () => {
  await assert.rejects(
    verifyHostAssets({ baseUrl: "https://host.test/", manifest, fetchImpl: fetcher({ "/assets/DocumentLifecycleModule-abc.js": "tampered" }), retries: 1, retryDelayMs: 0 }),
    error => error.check === "a"
  );
});

test("missing entry bundle fails HTTP 200 requirement (b)", async () => {
  await assert.rejects(
    verifyHostAssets({ baseUrl: "https://host.test/", manifest, fetchImpl: fetcher({ "/assets/index-entry.js": null }), retries: 1, retryDelayMs: 0 }),
    error => error.check === "b"
  );
});

test("missing imported dependency fails HTTP 200 requirement (d)", async () => {
  await assert.rejects(
    verifyHostAssets({ baseUrl: "https://host.test/", manifest, fetchImpl: fetcher({ "/assets/dependency.js": null }), retries: 1, retryDelayMs: 0 }),
    error => error.check === "d"
  );
});
