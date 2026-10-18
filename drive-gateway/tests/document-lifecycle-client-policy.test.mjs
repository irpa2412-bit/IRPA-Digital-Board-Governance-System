import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveGatewayUrl } from "../../src/firebase/gatewayEnvironment.js";

const root = new URL("../../", import.meta.url);
const client = readFileSync(new URL("../../src/firebase/documentLifecycle.js", import.meta.url), "utf8");

test("document lifecycle resolves its gateway through the shared environment policy", () => {
  assert.match(client, /import\s*\{\s*resolveGatewayUrl\s*\}\s*from\s*["']\.\/gatewayEnvironment["']/);
  assert.match(client, /resolveGatewayUrl\(\)/);
  assert.doesNotMatch(client, /PRODUCTION_GATEWAY_URL|STAGING_GATEWAY_URL|\|\|\s*["']https:\/\/irpa-google-drive-gateway/);
});

test("the shared policy resolves staging only from an explicit matching environment", () => {
  assert.equal(resolveGatewayUrl({
    VITE_IRPA_ENV: "staging",
    VITE_FIREBASE_PROJECT_ID: "irpa-dbg-staging-a73ec",
    VITE_FIREBASE_AUTH_DOMAIN: "irpa-dbg-staging-a73ec.firebaseapp.com"
  }), "https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev");
  assert.throws(() => resolveGatewayUrl({
    VITE_FIREBASE_PROJECT_ID: "irpa-digital-board-governance"
  }), /VITE_IRPA_ENV/);
  assert.throws(() => resolveGatewayUrl({
    VITE_IRPA_ENV: "staging",
    VITE_FIREBASE_PROJECT_ID: "irpa-digital-board-governance"
  }), /does not match VITE_IRPA_ENV/);
});
