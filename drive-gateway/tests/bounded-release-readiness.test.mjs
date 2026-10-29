import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gateway = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

test("outbound Worker requests are bounded to eight seconds", () => {
  assert.match(gateway, /async function boundedFetch\([\s\S]*?setTimeout\(\(\) => controller\.abort\([\s\S]*?8000/);
  assert.match(gateway, /return await globalThis\.fetch\(input, \{ \.\.\.init, signal: controller\.signal \}\)/);
  assert.match(gateway, /\bboundedFetch\(/);
});

test("signature reconciliation returns pages of five and a continuation marker", () => {
  assert.match(gateway, /items\.slice\(requestedOffset, requestedOffset \+ 5\)/);
  assert.match(gateway, /nextOffset:more\?/);
  assert.match(gateway, /more,/);
});

test("dispatch errors include route, step, and CORS headers", () => {
  assert.match(gateway, /const routeName = url\.pathname/);
  assert.match(gateway, /step: "dispatch"/);
  assert.match(gateway, /corsHeaders\(request\)/);
});

test("upload policy check maps missing authentication to HTTP 401", () => {
  assert.match(gateway, /authentication\|authorization header\|bearer token\|token is required\|missing\.\*token/i);
});
