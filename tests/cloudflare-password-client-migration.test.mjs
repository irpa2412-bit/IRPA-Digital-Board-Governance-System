import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/firebase/auth.js", import.meta.url), "utf8");

test("password-attempt state is routed through the Cloudflare Worker", () => {
  assert.match(source, /\/api\/auth\/password-attempt-state/);
  assert.match(source, /\/api\/auth\/password-failure/);
  assert.match(source, /\/api\/auth\/password-attempt-clear/);
  assert.match(source, /GOVERNANCE_GATEWAY_ORIGIN/);
});

test("password-attempt controls do not call billing-blocked Firebase callables", () => {
  assert.doesNotMatch(source, /httpsCallable\(functions,\s*["']checkPasswordAttemptState["']\)/);
  assert.doesNotMatch(source, /httpsCallable\(functions,\s*["']recordPasswordFailure["']\)/);
  assert.doesNotMatch(source, /httpsCallable\(getFunctions\(undefined,\s*["']us-central1["']\),\s*["']clearPasswordAttemptState["']\)/);
});
