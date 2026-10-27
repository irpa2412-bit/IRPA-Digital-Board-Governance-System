import test from "node:test";
import assert from "node:assert/strict";
import worker from "../drive-gateway/src/index.js";

const origin = "https://irpa-digital-board-governance.web.app";

for (const method of ["PUT", "PATCH"]) {
  test(`Worker CORS preflight allows ${method}`, async () => {
    const response = await worker.fetch(new Request("https://gateway.example/api/communications/editorial/items/test", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "authorization,content-type"
      }
    }), {});

    assert.equal(response.status, 204);
    const allowedMethods = response.headers.get("Access-Control-Allow-Methods") || "";
    assert.ok(allowedMethods.split(",").map(value => value.trim()).includes(method), allowedMethods);
    const allowedHeaders = (response.headers.get("Access-Control-Allow-Headers") || "").toLowerCase();
    assert.ok(allowedHeaders.split(",").map(value => value.trim()).includes("authorization"), allowedHeaders);
    assert.ok(allowedHeaders.split(",").map(value => value.trim()).includes("content-type"), allowedHeaders);
  });
}
