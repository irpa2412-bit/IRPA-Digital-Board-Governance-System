import test from "node:test";
import assert from "node:assert/strict";
import handler from "../src/index.js";

const testUid = "qv5soS4LGra78iNqJpAVq0RpMUv1";
const secret = "c".repeat(64);
const env = {
  IRPA_ENVIRONMENT: "staging",
  FIREBASE_PROJECT_ID: "irpa-dbg-staging-a73ec",
  ADMIN_REGISTRATION_RESET_ENABLED: "true",
  STAGING_ADMIN_RESET_TEST_UID: testUid,
  IRPA_RESET_DEVELOPER_SECRET: secret
};
async function call(path, {method="GET", environment=env, headers={}, body}={}) {
  return handler.fetch(new Request("https://gateway-staging.test" + path, {
    method, headers, body
  }), environment);
}

test("staging operator page is no-store, scoped, and never exposes the recovery secret", async () => {
  const response = await call("/admin-registration-reset-staging-test");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /no-store/i);
  assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  const html = await response.text();
  assert.match(html, new RegExp(testUid));
  assert.match(html, /irpa-dbg-staging-a73ec/);
  assert.match(html, /signInWithEmailAndPassword/);
  assert.doesNotMatch(html, new RegExp(secret));
  assert.doesNotMatch(html, /x-irpa-reset-secret/i);
});

test("staging operator page is unavailable outside exact staging configuration", async () => {
  assert.equal((await call("/admin-registration-reset-staging-test", {
    environment: {...env, IRPA_ENVIRONMENT:"production"}
  })).status, 404);
  assert.equal((await call("/admin-registration-reset-staging-test", {
    environment: {...env, FIREBASE_PROJECT_ID:"irpa-digital-board-governance"}
  })).status, 404);
  assert.equal((await call("/admin-registration-reset-staging-test", {
    environment: {...env, ADMIN_REGISTRATION_RESET_ENABLED:"false"}
  })).status, 404);
  assert.equal((await call("/admin-registration-reset-staging-test", {
    environment: {...env, STAGING_ADMIN_RESET_TEST_UID:"different-test-uid"}
  })).status, 404);
});

test("staging proxy rejects any target other than the fixed test UID", async () => {
  const response = await call("/api/admin-registration/reset-staging-test", {
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({targetUid:"some-other-user"})
  });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /only the dedicated staging test profile/i);
});

test("staging proxy rejects client-supplied recovery secret headers", async () => {
  const response = await call("/api/admin-registration/reset-staging-test", {
    method:"POST",
    headers:{"content-type":"application/json","x-irpa-reset-secret":secret},
    body:JSON.stringify({targetUid:testUid})
  });
  assert.equal(response.status, 400);
});

test("staging proxy requires Firebase authentication and does not accept a browser secret", async () => {
  const response = await call("/api/admin-registration/reset-staging-test", {
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({
      targetUid:testUid,
      operationId:"123e4567-e89b-42d3-a456-426614174000",
      confirmation:"RESET ADMIN REGISTRATION ONLY",
      reason:"Controlled staging verification of administrator registration recovery."
    })
  });
  assert.equal(response.status, 401);
});
