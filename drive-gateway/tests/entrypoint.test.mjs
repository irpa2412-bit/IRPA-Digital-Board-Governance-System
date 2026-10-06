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
    env:{ESIGN_MODULE_ENABLED:"true", DRIVE_MOCK:"true", ALLOWED_ORIGINS:"https://irpa-digital-board-governance.web.app"},
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
test("regression: /api/upload-controlled-document remains authentication-gated", async () => {
  const r = await call("/api/upload-controlled-document", {
    method:"POST",
    env:{ESIGN_MODULE_ENABLED:"true", DRIVE_MOCK:"true"},
    headers:{"content-type":"application/json"},
    body:"{}"
  });
  assert.equal(r.status, 401);
});

test("regression: /api/signature-invitations/send remains authentication-gated", async () => {
  const r = await call("/api/signature-invitations/send", {
    method:"POST",
    env:{ESIGN_MODULE_ENABLED:"true", DRIVE_MOCK:"true"},
    headers:{"content-type":"application/json"},
    body:"{}"
  });
  assert.equal(r.status, 401);
});

test("regression: /api/invitations/send remains authentication-gated", async () => {
  const r = await call("/api/invitations/send", {
    method:"POST",
    env:{ESIGN_MODULE_ENABLED:"true", DRIVE_MOCK:"true"},
    headers:{"content-type":"application/json"},
    body:"{}"
  });
  assert.equal(r.status, 401);
});


test("Cloudflare auth migration flag-off keeps password attempt state unavailable", async () => {
  const r = await call("/api/auth/password-attempt-state", {
    method:"POST",
    env:{ESIGN_MODULE_ENABLED:"true", CLOUDFLARE_AUTH_FUNCTIONS_ENABLED:"false", DRIVE_MOCK:"true"},
    headers:{"content-type":"application/json"},
    body:JSON.stringify({email:"test@example.com"})
  });
  assert.equal(r.status, 404);
});

test("Cloudflare auth migration flag-on returns initial password attempt state", async () => {
  const r = await call("/api/auth/password-attempt-state", {
    method:"POST",
    env:{ESIGN_MODULE_ENABLED:"true", CLOUDFLARE_AUTH_FUNCTIONS_ENABLED:"true", DRIVE_MOCK:"true"},
    headers:{"content-type":"application/json"},
    body:JSON.stringify({email:"cloudflare-migration@example.com"})
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {allowed:true,status:"FIRST",remainingAttempts:3,resetRequired:false});
});

test("Cloudflare auth migration preserves three-attempt lock semantics", async () => {
  const env={ESIGN_MODULE_ENABLED:"true", CLOUDFLARE_AUTH_FUNCTIONS_ENABLED:"true", DRIVE_MOCK:"true"};
  const headers={"content-type":"application/json"};
  for (let i=1;i<=2;i++) {
    const r=await call("/api/auth/password-failure",{method:"POST",env,headers,body:JSON.stringify({email:"lock-test@example.com"})});
    assert.equal(r.status,200);
    const body=await r.json();
    assert.equal(body.status,"FIRST");
    assert.equal(body.remainingAttempts,3-i);
  }
  const locked=await call("/api/auth/password-failure",{method:"POST",env,headers,body:JSON.stringify({email:"lock-test@example.com"})});
  assert.equal(locked.status,200);
  assert.equal((await locked.json()).status,"LOCKED");
});

test("Cloudflare auth migration clears password attempt state", async () => {
  const env={ESIGN_MODULE_ENABLED:"true", CLOUDFLARE_AUTH_FUNCTIONS_ENABLED:"true", DRIVE_MOCK:"true"};
  const headers={"content-type":"application/json"};
  await call("/api/auth/password-failure",{method:"POST",env,headers,body:JSON.stringify({email:"clear-test@example.com"})});
  const cleared=await call("/api/auth/password-attempt-clear",{method:"POST",env,headers,body:JSON.stringify({email:"clear-test@example.com"})});
  assert.equal(cleared.status,200);
  assert.deepEqual(await cleared.json(),{ok:true});
  const state=await call("/api/auth/password-attempt-state",{method:"POST",env,headers,body:JSON.stringify({email:"clear-test@example.com"})});
  assert.equal((await state.json()).status,"FIRST");
});

test("Cloudflare document-reference migration remains authentication-gated", async () => {
  const r=await call("/api/documents/next-reference",{
    method:"POST",
    env:{ESIGN_MODULE_ENABLED:"true", CLOUDFLARE_AUTH_FUNCTIONS_ENABLED:"true", DRIVE_MOCK:"true"}
  });
  assert.equal(r.status,401);
});

test("Cloudflare auth migration rejects malformed password-state input", async () => {
  const r=await call("/api/auth/password-attempt-state",{
    method:"POST",
    env:{ESIGN_MODULE_ENABLED:"true", CLOUDFLARE_AUTH_FUNCTIONS_ENABLED:"true", DRIVE_MOCK:"true"},
    headers:{"content-type":"application/json"},
    body:JSON.stringify({email:"not-an-email"})
  });
  assert.equal(r.status,400);
});
