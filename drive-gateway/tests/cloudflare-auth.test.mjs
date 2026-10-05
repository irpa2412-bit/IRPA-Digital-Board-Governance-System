import test from "node:test";
import assert from "node:assert/strict";
import { routeCloudflareAuth } from "../src/cloudflareAuth.mjs";
import { EsignRecordDurableObject } from "../src/esignContext.mjs";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  async get(key) { return this.data.get(key); }
  async put(key, value) { this.data.set(key, value); }
  async delete(key) { this.data.delete(key); }
}

class MemoryNamespace {
  constructor() { this.objects = new Map(); }
  idFromName(name) { return String(name); }
  get(id) {
    if (!this.objects.has(id)) {
      const storage = new MemoryStorage();
      const state = {
        storage,
        blockConcurrencyWhile: async fn => fn()
      };
      this.objects.set(id, { storage, object: new EsignRecordDurableObject(state, {}) });
    }
    return {
      fetch: request => this.objects.get(id).object.fetch(request)
    };
  }
}

function env(overrides = {}) {
  return {
    CLOUDFLARE_AUTH_FUNCTIONS_ENABLED: "true",
    DRIVE_MOCK: "false",
    ESIGN_DO: new MemoryNamespace(),
    ...overrides
  };
}

async function emailKey(email) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return "auth-state:" + Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function call(path, body, environment, authenticate = async () => ({ user_id: "uid-1", email: "admin@example.com" })) {
  return routeCloudflareAuth(
    new Request("https://gateway.test" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    environment,
    authenticate
  );
}

test("flag off leaves migrated routes untouched", async () => {
  const response = await call("/api/auth/password-attempt-state", { email: "a@example.com" }, env({ CLOUDFLARE_AUTH_FUNCTIONS_ENABLED: "false" }));
  assert.equal(response, null);
});

test("password state starts in FIRST stage with three attempts", async () => {
  const response = await call("/api/auth/password-attempt-state", { email: "a@example.com" }, env());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { allowed: true, status: "FIRST", remainingAttempts: 3, resetRequired: false });
});

test("three failures lock the account for five minutes", async () => {
  const environment = env();
  for (const expected of [2, 1]) {
    const response = await call("/api/auth/password-failure", { email: "a@example.com" }, environment);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).remainingAttempts, expected);
  }
  const locked = await call("/api/auth/password-failure", { email: "a@example.com" }, environment);
  const body = await locked.json();
  assert.equal(body.status, "LOCKED");
  assert.equal(body.remainingAttempts, 0);
  assert.ok(body.retryAfterSeconds >= 299);
});

test("clear resets suspended state back to FIRST", async () => {
  const environment = env();
  const email = "suspend@example.com";
  for (let i = 0; i < 3; i++) await call("/api/auth/password-failure", { email }, environment);

  const key = await emailKey(email);
  const stub = environment.ESIGN_DO.get(environment.ESIGN_DO.idFromName(key));
  const expired = await stub.fetch("https://irpa-auth.internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "auth-expire-lock", key })
  });
  assert.equal(expired.status, 200);

  for (let i = 0; i < 3; i++) await call("/api/auth/password-failure", { email }, environment);
  const suspended = await call("/api/auth/password-failure", { email }, environment);
  assert.equal((await suspended.json()).status, "SUSPENDED");

  const cleared = await call("/api/auth/password-attempt-clear", { email }, environment);
  assert.deepEqual(await cleared.json(), { ok: true });
  const state = await call("/api/auth/password-attempt-state", { email }, environment);
  assert.equal((await state.json()).status, "FIRST");
});

test("next document reference requires Firebase authentication", async () => {
  const response = await call("/api/documents/next-reference", {}, env(), async () => {
    throw new Error("Firebase authentication is required.");
  });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Authentication is required/);
});

test("next document references increment atomically in the dedicated DO", async () => {
  const environment = env();
  const first = await call("/api/documents/next-reference", {}, environment);
  const second = await call("/api/documents/next-reference", {}, environment);
  const a = await first.json();
  const b = await second.json();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(a.year, b.year);
  assert.match(a.reference, /^IRPA-DOC-\d{4}-00001$/);
  assert.match(b.reference, /^IRPA-DOC-\d{4}-00002$/);
});

test("invalid email is rejected without creating state", async () => {
  const response = await call("/api/auth/password-failure", { email: "not-an-email" }, env());
  assert.equal(response.status, 400);
});
