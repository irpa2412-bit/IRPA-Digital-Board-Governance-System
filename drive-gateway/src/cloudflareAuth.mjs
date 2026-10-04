import { HttpError, json } from "./util.mjs";

const mockState = new Map();
let mockReference = 0;
let authenticateFirebaseRequestForAuthRoute = null;

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

async function doCall(env, operation, payload = {}) {
  const key = String(payload.key || operation);
  const r = await env.ESIGN_DO.get(env.ESIGN_DO.idFromName(key)).fetch("https://irpa-auth.internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, ...payload })
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || "Cloudflare authentication state operation failed.");
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

export async function routeCloudflareAuth(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (env.CLOUDFLARE_AUTH_FUNCTIONS_ENABLED !== "true") return null;
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

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
    if (typeof authenticateFirebaseRequestForAuthRoute !== "function") {
      throw new HttpError(500, "Firebase authentication verifier was not provided.");
    }
    const claims = await authenticateFirebaseRequestForAuthRoute(request);
    const result = env.DRIVE_MOCK === "true"
      ? { reference: "IRPA-DOC-" + new Date().getUTCFullYear() + "-" + String(++mockReference).padStart(5, "0"), year: new Date().getUTCFullYear() }
      : await doCall(env, "next-reference", { key: "document-reference-counter" });
    return json(200, { ok: true, ...result, issuedBy: "SYSTEM", issuedByUid: claims.user_id, issuedByEmail: claims.email || null });
  }

  return null;
}

export function buildCloudflareAuthContext({ authenticate }) {
  authenticateFirebaseRequestForAuthRoute = authenticate;
}
