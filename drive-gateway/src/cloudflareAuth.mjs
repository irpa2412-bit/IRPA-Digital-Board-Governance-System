import { HttpError, json } from "./util.mjs";

const mockState = new Map();
let mockReference = 0;

const LOCK_MS = 5 * 60 * 1000;
const FIRST_STAGE_LIMIT = 3;
const SECOND_STAGE_LIMIT = 3;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function sha256Hex(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function validEmail(email) {
  return Boolean(email && email.includes("@"));
}

function jsonBody(response) {
  return response.json().catch(() => ({}));
}

export class AuthStateDurableObject {
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request) {
    const body = await request.json().catch(() => ({}));
    const operation = String(body.operation || "");
    const key = String(body.key || "");
    if (!key) return json(400, { ok: false, error: "State key is required." });

    if (operation === "auth-get") {
      return json(200, { ok: true, state: (await this.storage.get("state")) || {} });
    }

    if (operation === "auth-record-failure") {
      const current = (await this.storage.get("state")) || {};
      const now = Date.now();
      if (current.stage === "SUSPENDED") {
        return json(200, { status: "SUSPENDED", resetRequired: true, remainingAttempts: 0 });
      }
      if (current.stage === "LOCKED" && Number(current.lockUntilMs || 0) > now) {
        return json(200, {
          status: "LOCKED",
          retryAfterSeconds: Math.ceil((Number(current.lockUntilMs) - now) / 1000),
          remainingAttempts: 0,
          resetRequired: false
        });
      }
      const stage = String(current.stage || "FIRST");
      const limit = stage === "SECOND" ? SECOND_STAGE_LIMIT : FIRST_STAGE_LIMIT;
      const failedAttempts = Number(current.failedAttempts || 0) + 1;
      if (failedAttempts < limit) {
        const next = { stage, failedAttempts, lockUntilMs: 0 };
        await this.storage.put("state", next);
        return json(200, { status: stage, remainingAttempts: limit - failedAttempts, resetRequired: false });
      }
      if (stage === "FIRST") {
        const next = { stage: "LOCKED", failedAttempts: 0, lockUntilMs: now + LOCK_MS };
        await this.storage.put("state", next);
        return json(200, {
          status: "LOCKED",
          retryAfterSeconds: Math.ceil(LOCK_MS / 1000),
          remainingAttempts: 0,
          resetRequired: false
        });
      }
      const next = { stage: "SUSPENDED", failedAttempts, lockUntilMs: 0 };
      await this.storage.put("state", next);
      return json(200, { status: "SUSPENDED", remainingAttempts: 0, resetRequired: true });
    }

    if (operation === "auth-clear") {
      await this.storage.put("state", { stage: "FIRST", failedAttempts: 0, lockUntilMs: 0 });
      return json(200, { ok: true });
    }

    if (operation === "auth-expire-lock") {
      const current = (await this.storage.get("state")) || {};
      if (current.stage === "LOCKED" && Number(current.lockUntilMs || 0) <= Date.now()) {
        await this.storage.put("state", { stage: "SECOND", failedAttempts: 0, lockUntilMs: 0 });
      }
      return json(200, { ok: true });
    }

    if (operation === "next-reference") {
      const year = new Date().getUTCFullYear();
      const keyName = "document-reference:" + year;
      const current = Number(await this.storage.get(keyName) || 0);
      const nextNumber = Math.max(1, current + 1);
      await this.storage.put(keyName, nextNumber);
      return json(200, {
        reference: "IRPA-DOC-" + year + "-" + String(nextNumber).padStart(5, "0"),
        year,
        sequenceNumber: nextNumber
      });
    }

    return json(400, { ok: false, error: "Unknown Cloudflare authentication state operation." });
  }
}

async function doCall(env, operation, payload = {}) {
  const key = String(payload.key || operation);
  const stub = env.AUTH_DO.get(env.AUTH_DO.idFromName(key));
  const response = await stub.fetch("https://irpa-auth.internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, ...payload })
  });
  const body = await jsonBody(response);
  if (!response.ok) throw new Error(body.error || "Cloudflare authentication state operation failed.");
  return body;
}

async function getState(env, key) {
  if (env.DRIVE_MOCK === "true") return structuredClone(mockState.get(key) || {});
  return (await doCall(env, "auth-get", { key })).state || {};
}

async function setFailure(env, key) {
  if (env.DRIVE_MOCK === "true") {
    const current = mockState.get(key) || {};
    const now = Date.now();
    if (current.stage === "SUSPENDED") return { status: "SUSPENDED", resetRequired: true, remainingAttempts: 0 };
    if (current.stage === "LOCKED" && Number(current.lockUntilMs || 0) > now) {
      return { status: "LOCKED", retryAfterSeconds: Math.ceil((current.lockUntilMs - now) / 1000), remainingAttempts: 0, resetRequired: false };
    }
    const stage = String(current.stage || "FIRST");
    const limit = stage === "SECOND" ? SECOND_STAGE_LIMIT : FIRST_STAGE_LIMIT;
    const failedAttempts = Number(current.failedAttempts || 0) + 1;
    if (failedAttempts < limit) {
      mockState.set(key, { stage, failedAttempts, lockUntilMs: 0 });
      return { status: stage, remainingAttempts: limit - failedAttempts, resetRequired: false };
    }
    if (stage === "FIRST") {
      mockState.set(key, { stage: "LOCKED", failedAttempts: 0, lockUntilMs: now + LOCK_MS });
      return { status: "LOCKED", retryAfterSeconds: Math.ceil(LOCK_MS / 1000), remainingAttempts: 0, resetRequired: false };
    }
    mockState.set(key, { stage: "SUSPENDED", failedAttempts, lockUntilMs: 0 });
    return { status: "SUSPENDED", remainingAttempts: 0, resetRequired: true };
  }
  return doCall(env, "auth-record-failure", { key });
}

async function clearState(env, key) {
  if (env.DRIVE_MOCK === "true") {
    mockState.set(key, { stage: "FIRST", failedAttempts: 0, lockUntilMs: 0 });
    return { ok: true };
  }
  return doCall(env, "auth-clear", { key });
}

async function expireLockToSecondStage(env, key) {
  if (env.DRIVE_MOCK === "true") {
    mockState.set(key, { stage: "SECOND", failedAttempts: 0, lockUntilMs: 0 });
    return;
  }
  await doCall(env, "auth-expire-lock", { key });
}

export async function routeCloudflareAuth(request, env, authenticate) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (env.CLOUDFLARE_AUTH_FUNCTIONS_ENABLED !== "true") return null;

  const isMigratedAuthPath =
    pathname === "/api/auth/password-attempt-state" ||
    pathname === "/api/auth/password-failure" ||
    pathname === "/api/auth/password-attempt-clear" ||
    pathname === "/api/documents/next-reference";
  if (!isMigratedAuthPath) return null;
  if (request.method !== "POST") return json(405, { ok: false, error: "Method not allowed." });

  if (pathname === "/api/auth/password-attempt-state") {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    if (!validEmail(email)) throw new HttpError(400, "A valid registered email address is required.");
    const key = "auth-state:" + await sha256Hex(email);
    let state = await getState(env, key);
    const now = Date.now();
    if (Number(state.lockUntilMs || 0) && Number(state.lockUntilMs) <= now && state.stage === "LOCKED") {
      await expireLockToSecondStage(env, key);
      state = { stage: "SECOND", failedAttempts: 0, lockUntilMs: 0 };
    }
    if (state.stage === "SUSPENDED") return json(200, { allowed: false, status: "SUSPENDED", remainingAttempts: 0, resetRequired: true });
    if (Number(state.lockUntilMs || 0) > now) {
      return json(200, { allowed: false, status: "LOCKED", remainingAttempts: 0, lockUntilMs: state.lockUntilMs, retryAfterSeconds: Math.ceil((state.lockUntilMs - now) / 1000), resetRequired: false });
    }
    const limit = state.stage === "SECOND" ? SECOND_STAGE_LIMIT : FIRST_STAGE_LIMIT;
    return json(200, { allowed: true, status: state.stage || "FIRST", remainingAttempts: Math.max(0, limit - Number(state.failedAttempts || 0)), resetRequired: false });
  }

  if (pathname === "/api/auth/password-failure") {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    if (!validEmail(email)) throw new HttpError(400, "A valid registered email address is required.");
    return json(200, await setFailure(env, "auth-state:" + await sha256Hex(email)));
  }

  if (pathname === "/api/auth/password-attempt-clear") {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    if (!validEmail(email)) throw new HttpError(400, "A valid registered email address is required.");
    return json(200, await clearState(env, "auth-state:" + await sha256Hex(email)));
  }

  if (pathname === "/api/documents/next-reference") {
    if (typeof authenticate !== "function") throw new HttpError(500, "Firebase authentication verifier was not provided.");
    let claims;
    try {
      claims = await authenticate(request);
    } catch (error) {
      const message = String(error?.message || error);
      if (message === "Firebase authentication is required." || message.startsWith("Invalid Firebase") || message === "Firebase token is expired." || message === "Firebase token signing key not found.") {
        throw new HttpError(401, "Authentication is required to generate a document reference.");
      }
      throw error;
    }
    const result = env.DRIVE_MOCK === "true"
      ? { reference: "IRPA-DOC-" + new Date().getUTCFullYear() + "-" + String(++mockReference).padStart(5, "0"), year: new Date().getUTCFullYear(), sequenceNumber: mockReference }
      : await doCall(env, "next-reference", { key: "document-reference-counter" });
    return json(200, { ok: true, ...result, issuedBy: "SYSTEM", issuedByUid: claims.user_id, issuedByEmail: claims.email || null });
  }

  return null;
}
