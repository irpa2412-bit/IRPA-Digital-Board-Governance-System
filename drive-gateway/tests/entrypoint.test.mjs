import test from "node:test";
import assert from "node:assert/strict";
import handler from "../src/index.js";

const base = "https://gw.test";

async function call(path, {method="GET", env={}, headers={}, body}={}) {
  const request = new Request(base + path, {method, headers, body});
  return handler.fetch(request, env);
}

test("entrypoint flag-off: /api/envelopes remains 404", async () => {
  const r = await call("/api/envelopes", {env:{ESIGN_MODULE_ENABLED:"false", DRIVE_MOCK:"true"}});
  assert.equal(r.status, 404);
});

test("entrypoint flag-off: /api/sign/open remains 404", async () => {
  const r = await call("/api/sign/open", {env:{ESIGN_MODULE_ENABLED:"false", DRIVE_MOCK:"true"}});
  assert.equal(r.status, 404);
});

test("entrypoint flag-on: /api/sign/open reaches e-sign router", async () => {
  const r = await call("/api/sign/open", {env:{ESIGN_MODULE_ENABLED:"true", DRIVE_MOCK:"true"}});
  assert.notEqual(r.status, 404);
  assert.equal(r.status, 401);
});

test("entrypoint flag-on: malformed signing token is rejected", async () => {
  const r = await call("/api/sign/open", {
    env:{ESIGN_MODULE_ENABLED:"true", DRIVE_MOCK:"true"},
    headers:{"x-signing-token":"bad"}
  });
  assert.equal(r.status, 401);
});

test("entrypoint flag-on: unauthenticated document upload is rejected", async () => {
  const r = await call("/api/documents", {
    method:"POST",
    env:{ESIGN_MODULE_ENABLED:"true", DRIVE_MOCK:"true"},
    headers:{"content-type":"application/json"},
    body:"{}"
  });
  assert.equal(r.status, 401);
});

test("CORS preflight from production web app allows signing token header", async () => {
  const r = await call("/api/sign/open", {
    method:"OPTIONS",
    env:{ESIGN_MODULE_ENABLED:"true", DRIVE_MOCK:"true"},
    headers:{Origin:"https://irpa-digital-board-governance.web.app"}
  });
  assert.equal(r.status, 204);
  assert.match(r.headers.get("access-control-allow-origin") || "", /irpa-digital-board-governance\.web\.app/);
  assert.match((r.headers.get("access-control-allow-headers") || "").toLowerCase(), /x-signing-token/);
});

test("regression: /health remains available", async () => {
  const r = await call("/health", {env:{ESIGN_MODULE_ENABLED:"false", DRIVE_MOCK:"true"}});
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});
