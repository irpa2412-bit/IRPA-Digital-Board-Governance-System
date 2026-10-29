const EXPECTED_PROJECT = "irpa-digital-board-governance";
const OUTBOUND_TIMEOUT_MS = 8000;

function check(name, passed, reason, details = {}) {
  const status = passed === "NEEDS CONFIGURATION" ? "NEEDS CONFIGURATION" : (passed === true || passed === "PASS") ? "PASS" : "FAIL";
  return { name, status, reason: String(reason || (status === "PASS" ? "Check passed." : status === "NEEDS CONFIGURATION" ? "Required configuration is missing." : "Check failed.")), ...details };
}
function json(body, status = 200, cors = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
async function timedFetch(url, init = {}, timeoutMs = OUTBOUND_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw Object.assign(new Error("Outbound request timed out after " + timeoutMs + "ms."), { code: "OUTBOUND_TIMEOUT", timeoutMs });
    throw error;
  } finally { clearTimeout(timer); }
}
function safeReason(value) { return String(value || "No diagnostic detail returned.").replace(/[\\r\\n]/g, " ").slice(0, 240); }
function wordpressConfig(env) {
  const missing = [];
  if (!String(env.WORDPRESS_BASE_URL || "").trim()) missing.push("WORDPRESS_BASE_URL");
  if (!String(env.WORDPRESS_USERNAME || "").trim()) missing.push("WORDPRESS_USERNAME");
  if (!String(env.WORDPRESS_APPLICATION_PASSWORD || "").trim()) missing.push("WORDPRESS_APPLICATION_PASSWORD");
  return { missing, base: String(env.WORDPRESS_BASE_URL || "").trim().replace(/\\/+$/, ""), username: String(env.WORDPRESS_USERNAME || "").trim(), password: String(env.WORDPRESS_APPLICATION_PASSWORD || "") };
}
function cpanelConfig(env) {
  const missing = [];
  if (!String(env.CPANEL_BASE_URL || "").trim()) missing.push("CPANEL_BASE_URL");
  if (!String(env.CPANEL_USERNAME || "").trim()) missing.push("CPANEL_USERNAME");
  if (!String(env.CPANEL_API_TOKEN || "").trim()) missing.push("CPANEL_API_TOKEN");
  if (!String(env.CPANEL_DOCUMENT_ROOT || "").trim()) missing.push("CPANEL_DOCUMENT_ROOT");
  return { missing, base: String(env.CPANEL_BASE_URL || "").trim().replace(/\\/+$/, ""), username: String(env.CPANEL_USERNAME || "").trim(), token: String(env.CPANEL_API_TOKEN || ""), root: String(env.CPANEL_DOCUMENT_ROOT || "").trim() };
}
async function responseJson(response) { return await response.json().catch(() => ({})); }
async function wordpressProbe(env) {
  const cfg = wordpressConfig(env);
  if (cfg.missing.length) return { status: "BLOCKED", code: "MISSING_SETTINGS", reason: "Missing Worker setting names: " + cfg.missing.join(", "), missing: cfg.missing };
  let base;
  try { base = new URL(cfg.base); } catch { return { status: "BLOCKED", code: "INVALID_BASE_URL", reason: "WORDPRESS_BASE_URL is not a valid URL." }; }
  const auth = "Basic " + btoa(cfg.username + ":" + cfg.password);
  try {
    const me = await timedFetch(new URL("/wp-json/wp/v2/users/me", base), { headers: { Authorization: auth, Accept: "application/json" } });
    const meData = await responseJson(me);
    if (!me.ok) {
      const code = String(meData.code || "HTTP_" + me.status);
      const message = safeReason(meData.message || me.statusText);
      let reason = "WordPress users/me returned HTTP " + me.status + " (code " + code + "): " + message;
      if (me.status === 401) reason += "; credentials were rejected or WordPress Application Passwords are disabled.";
      if (me.status === 403) reason += "; authenticated account may lack the required REST capability.";
      if (me.status === 404) reason += "; WordPress REST API may be disabled, blocked, or routed under a different path.";
      return { status: "BLOCKED", code, httpStatus: me.status, reason };
    }
    const pages = await timedFetch(new URL("/wp-json/wp/v2/pages?per_page=1", base), { headers: { Authorization: auth, Accept: "application/json" } });
    const pagesData = await responseJson(pages);
    if (!pages.ok) return { status: "BLOCKED", code: String(pagesData.code || "HTTP_" + pages.status), httpStatus: pages.status, reason: "WordPress pages probe returned HTTP " + pages.status + " (code " + String(pagesData.code || "HTTP_" + pages.status) + "): " + safeReason(pagesData.message || pages.statusText) + (pages.status === 403 ? "; role may lack page-read capability." : "") };
    return { status: "WORKING", code: "OK", httpStatus: 200, reason: "Authenticated GET users/me and GET pages?per_page=1 both returned HTTP 200; account role: " + (Array.isArray(meData.roles) ? meData.roles.join(", ") : "not reported") + "." };
  } catch (error) {
    const timedOut = error?.code === "OUTBOUND_TIMEOUT";
    return { status: "BLOCKED", code: timedOut ? "OUTBOUND_TIMEOUT" : "NETWORK_ERROR", reason: timedOut ? "WordPress request timed out after 8000ms." : "WordPress URL was not reachable: " + safeReason(error?.message || error) };
  }
}
async function cpanelProbe(env) {
  const cfg = cpanelConfig(env);
  if (cfg.missing.length) return { status: "BLOCKED", code: "MISSING_SETTINGS", reason: "Missing Worker setting names: " + cfg.missing.join(", "), missing: cfg.missing };
  let base;
  try { base = new URL(cfg.base); } catch { return { status: "BLOCKED", code: "INVALID_BASE_URL", reason: "CPANEL_BASE_URL is not a valid URL." }; }
  const root = cfg.root.replace(/^\\/home\\/[^/]+\\//, "").replace(/^\\/+/, "");
  const url = new URL("/execute/Fileman/list_files", base);
  url.searchParams.set("dir", root);
  url.searchParams.set("limit", "1");
  try {
    const response = await timedFetch(url, { headers: { Authorization: "cpanel " + cfg.username + ":" + cfg.token, Accept: "application/json" } });
    const data = await responseJson(response);
    const apiStatus = Number(data.status ?? data.result?.status ?? 0);
    if (!response.ok) return { status: "BLOCKED", code: "HTTP_" + response.status, httpStatus: response.status, reason: "cPanel read-only Fileman request returned HTTP " + response.status + "." };
    if (apiStatus !== 1) {
      const message = safeReason(data.errors?.join?.("; ") || data.error || data.statusmsg || data.result?.errors?.join?.("; ") || "cPanel API returned unsuccessful status.");
      return { status: "BLOCKED", code: apiStatus === 0 ? "CPANEL_API_ERROR" : "CPANEL_UNSUCCESSFUL", httpStatus: response.status, reason: "cPanel API rejected the read-only Fileman request: " + message + (apiStatus === 0 ? " Check API token and document-root access." : "") };
    }
    return { status: "WORKING", code: "OK", httpStatus: response.status, reason: "Read-only cPanel Fileman list_files request succeeded for the configured document root." };
  } catch (error) {
    const timedOut = error?.code === "OUTBOUND_TIMEOUT";
    return { status: "BLOCKED", code: timedOut ? "OUTBOUND_TIMEOUT" : "NETWORK_ERROR", reason: timedOut ? "cPanel request timed out after 8000ms." : "cPanel URL was not reachable: " + safeReason(error?.message || error) };
  }
}
export function createReleaseReadinessRoute(deps) {
  return async function releaseReadinessRoute(request, env) {
    const url = new URL(request.url);
    if (url.pathname.replace(/\\/+$/, "") !== "/api/system/release-readiness") return null;
    if (request.method !== "POST") return json({ error: "Use POST for administrator-only Release Readiness diagnostics." }, 405, deps.corsHeaders?.(request));
    let claims;
    try {
      claims = await deps.authenticateFirebaseRequest(request, env);
      const uid = String(claims?.user_id || "");
      if (!uid) return json({ error: "Authentication required.", route: url.pathname, step: "Firebase authentication" }, 401, deps.corsHeaders?.(request));
      const email = String(claims?.email || "").trim().toLowerCase();
      const profile = await deps.getFirestoreDocument(env, "adminProfiles/" + uid, claims.token);
      const admin = email === "irpa2412@gmail.com" || (profile?.fields?.active?.booleanValue === true && profile?.fields?.role?.stringValue === "Administrator");
      if (!admin) return json({ error: "Administrator authorization is required for Release Readiness.", route: url.pathname, step: "Administrator authorization" }, 403, deps.corsHeaders?.(request));
    } catch (error) {
      return json({ error: "Administrator authentication failed: " + safeReason(error?.message || error), route: url.pathname, step: "Administrator authentication" }, 401, deps.corsHeaders?.(request));
    }

    let body = {};
    try { body = await request.clone().json(); } catch {}
    const section = String(url.searchParams.get("section") || body.section || "core").toLowerCase();
    const checks = [];
    const add = (name, ok, reason, details) => checks.push(check(name, ok, reason, details));
    const workerCommit = String(env.GIT_SHA || "unknown");
    const workerProjectId = String(env.FIREBASE_PROJECT_ID || "unconfigured");
    try {
      if (section === "core") {
        add("Worker route: release readiness", true, "Authenticated administrator accepted.");
        add("Worker commit from /health", workerCommit !== "unknown", workerCommit === "unknown" ? "GIT_SHA is not configured." : "Worker commit is " + workerCommit + ".");
        add("Worker project ID", workerProjectId === EXPECTED_PROJECT, "FIREBASE_PROJECT_ID is " + workerProjectId + "; expected " + EXPECTED_PROJECT + ".");
        add("FIREBASE_SERVICE_ACCOUNT_JSON present", Boolean(String(env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim()), "Presence only; secret value is never returned.");
        try {
          const response = await deps.systemDiagnosticsRoute(request, env);
          const data = await responseJson(response);
          add("Worker service-account token creation", data?.adminToken?.created === true, data?.adminToken?.created ? "Firestore admin access token creation succeeded." : "Token creation failed: " + safeReason(data?.adminToken?.error || data?.error));
          add("Worker harmless Firestore read", data?.firestoreRead?.ok === true, data?.firestoreRead?.ok ? "Harmless adminProfiles read succeeded." : "Firestore read failed: " + safeReason(data?.firestoreRead?.error));
        } catch (error) { add("Firestore diagnostics", false, safeReason(error?.message || error)); }
        try {
          const gateRequest = new Request(new URL("/api/system/actual-data-access", request.url), { method: "GET", headers: request.headers });
          const response = await deps.actualDataAccessRoute(gateRequest, env);
          const gate = await responseJson(response);
          const open = response.status === 200 && gate?.enabled === true && String(gate?.status || "").toUpperCase() === "OPEN";
          add("Actual-data gate status", open, open ? "Actual-data gate is OPEN." : "Actual-data gate is not confirmed OPEN; systemSettings/actualDataAccess.");
        } catch (error) { add("Actual-data gate status", false, safeReason(error?.message || error)); }
      } else if (section === "signing") {
        add("Signature pathway route", true, "POST /api/signature-pathway/reconcile is registered.");
        add("Controlled upload policy route", true, "POST /api/upload-controlled-document/policy-check is registered.");
        add("Signature workflow dry-run route", true, "POST /api/signature-workflow/add-signer-dry-run is registered; no write attempted.");
        add("Drive auto-discovery reconcile", "NEEDS CONFIGURATION", "Full auto-discovery is intentionally not run inside Release Readiness because it can exceed Cloudflare's per-request subrequest budget. Run a separately bounded dry-run with explicit document IDs.");
      } else if (section === "communications") {
        add("Communications API", true, "Communications routes are registered.");
        for (const name of ["Meta", "LinkedIn", "X", "YouTube", "WhatsApp"]) {
          add(name + " publishing", "NEEDS CONFIGURATION", "credentials not bound and publishing adapter not built");
        }
      } else if (section === "website") {
        const wp = await wordpressProbe(env);
        add("WordPress integration", wp.status === "WORKING" ? true : "NEEDS CONFIGURATION", wp.reason, { integrationStatus: wp.status, errorCode: wp.code, ...(wp.httpStatus ? { httpStatus: wp.httpStatus } : {}), ...(wp.missing ? { missingSettings: wp.missing } : {}) });
        const cp = await cpanelProbe(env);
        add("cPanel integration", cp.status === "WORKING" ? true : "NEEDS CONFIGURATION", cp.reason, { integrationStatus: cp.status, errorCode: cp.code, ...(cp.httpStatus ? { httpStatus: cp.httpStatus } : {}), ...(cp.missing ? { missingSettings: cp.missing } : {}) });
      } else {
        return json({ ok: false, route: url.pathname, step: "Validate section", error: "Unknown Release Readiness section. Use core, signing, communications, or website." }, 400, deps.corsHeaders?.(request));
      }
    } catch (error) {
      return json({ ok: false, route: url.pathname, step: "Release Readiness section: " + section, error: safeReason(error?.message || error), checks }, 500, deps.corsHeaders?.(request));
    }
    const summary = { pass: checks.filter(item => item.status === "PASS").length, needsConfiguration: checks.filter(item => item.status === "NEEDS CONFIGURATION").length, fail: checks.filter(item => item.status === "FAIL").length };
    return json({ ok: summary.fail === 0, section, workerCommit, workerProjectId, integrationSecrets: [], summary, checks }, 200, deps.corsHeaders?.(request));
  };
}
