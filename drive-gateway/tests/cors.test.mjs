import test from "node:test";
import assert from "node:assert/strict";
import handler from "../src/index.js";

async function options(origin, environment) {
  return handler.fetch(
    new Request("https://gateway.test/api/invitations/redeem", {
      method: "OPTIONS",
      headers: { Origin: origin }
    }),
    environment
  );
}

test("CORS allows only configured production origins", async () => {
  const allowed = await options("https://irpa.or.tz", {
    ALLOWED_ORIGINS: "https://irpa.or.tz,https://www.irpa.or.tz,http://localhost:5173"
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), "https://irpa.or.tz");

  const denied = await options("https://attacker.example", {
    ALLOWED_ORIGINS: "https://irpa.or.tz,https://www.irpa.or.tz,http://localhost:5173"
  });
  assert.equal(denied.status, 204);
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
});

test("CORS staging allowlist permits localhost but not production origins", async () => {
  const localhost = await options("http://localhost:5173", {
    ALLOWED_ORIGINS: "http://localhost:5173"
  });
  assert.equal(localhost.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");

  const production = await options("https://irpa-digital-board-governance.web.app", {
    ALLOWED_ORIGINS: "http://localhost:5173"
  });
  assert.equal(production.headers.get("Access-Control-Allow-Origin"), null);
});

test("CORS fails closed when ALLOWED_ORIGINS is missing", async () => {
  const response = await options("https://irpa.or.tz", {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});
