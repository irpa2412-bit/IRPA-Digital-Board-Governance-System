import test from "node:test";
import assert from "node:assert/strict";
import { createCommunicationsSiteRouter } from "../src/communicationsSite.mjs";

const APP_PASSWORD = "abcd efgh ijkl mnop qrst uvwx";
const APP_PASSWORD_COMPACT = "abcdefghijklmnopqrstuvwx";

function makeResponse(body, status = 200, headers = { "Content-Type": "application/json" }) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

function makeRouter() {
  return createCommunicationsSiteRouter({
    authenticateFirebaseRequest: async () => ({ user_id: "diag-user", email: "diag@example.test", token: "firebase-token", role: "Communications Officer" }),
    getFirestoreDocument: async () => ({ active: false }),
    getInstitutionalProfileForUser: async () => ({ memberRecord: { role: "Communications Officer", status: "Active" }, employeeRecord: null }),
    firestoreDocumentToPlain: value => value,
    commitDocumentAndAudit: async () => {},
    json: (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } }),
    corsHeaders: () => ({})
  });
}

function env(overrides = {}) {
  return {
    IRPA_ENVIRONMENT: "staging",
    IRPA_WORKER_ENVIRONMENT: "staging",
    IRPA_WORKER_NAME: "irpa-google-drive-gateway-staging",
    WORDPRESS_BASE_URL: "https://staging.irpa.or.tz/wp-json/",
    WORDPRESS_USERNAME: "integration-editor",
    WORDPRESS_APPLICATION_PASSWORD: APP_PASSWORD,
    ...overrides
  };
}

async function status(router, config) {
  return router(new Request("https://gateway.test/api/communications/site/status", {
    headers: { Authorization: "Bearer firebase-token" }
  }), config);
}

test("WordPress diagnostics probes authenticated users/me and unauthenticated REST discovery; spaced app password is compacted", async () => {
  const router = makeRouter();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof URL ? input.href : String(input));
    calls.push({ url, headers: new Headers(init.headers), redirect: init.redirect });
    if (url.pathname === "/wp-json/wp/v2/users/me") {
      assert.equal(new Headers(init.headers).get("authorization"), "Basic " + btoa("integration-editor:" + APP_PASSWORD_COMPACT));
      assert.equal(init.redirect, "manual");
      return makeResponse({ id: 42, name: "Integration Editor", roles: ["editor"], capabilities: { edit_posts: true, edit_pages: true } });
    }
    if (url.pathname === "/wp-json/") {
      assert.equal(new Headers(init.headers).has("authorization"), false);
      return makeResponse({ name: "IRPA staging", routes: {} });
    }
    throw new Error("Unexpected WordPress request: " + url.pathname);
  };
  try {
    const response = await status(router, env());
    const data = (await response.json()).connections;
    assert.equal(data.website, "connected");
    assert.equal(data.workerEnvironment, "staging");
    assert.equal(data.secretChecks.boundToServingWorkerEnvironment, true);
    assert.equal(data.secretChecks.format.baseUrl.hasWpJsonSuffix, true);
    assert.equal(data.secretChecks.format.applicationPassword.length, 24);
    assert.equal(data.secretChecks.format.applicationPassword.containsSpaces, true);
    assert.equal(data.websiteResponseType, "application/json");
    assert.equal(data.websitePublicRest.status, 200);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WordPress diagnostics report upload_files capability as granted, missing, or unknown", async () => {
  const router = makeRouter();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof URL ? input.href : String(input));
    if (url.pathname === "/wp-json/wp/v2/users/me") return makeResponse({ id: 42, name: "Integration Editor", roles: ["editor"], capabilities: { edit_posts: true, edit_pages: true, upload_files: false } });
    if (url.pathname === "/wp-json/") return makeResponse({ name: "IRPA staging", routes: {} });
    throw new Error("Unexpected WordPress request: " + url.pathname);
  };
  try {
    const response = await status(router, env());
    const data = (await response.json()).connections;
    assert.equal(data.websiteAccount.canUploadFiles, false);
    assert.equal(data.websiteAccount.uploadFilesCapability, "missing");
  } finally { globalThis.fetch = originalFetch; }
});

test("media upload is blocked with a clear error when WordPress upload_files is missing", async () => {
  const router = makeRouter();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async input => {
    const url = new URL(input instanceof URL ? input.href : String(input));
    calls.push(url.pathname);
    if (url.pathname === "/wp-json/wp/v2/users/me") return makeResponse({ id: 42, roles: ["editor"], capabilities: { edit_posts: true, edit_pages: true, upload_files: false } });
    throw new Error("Media endpoint must not be called when upload_files is missing.");
  };
  try {
    const response = await router(new Request("https://gateway.test/api/communications/website/media", {
      method: "POST", headers: { Authorization: "Bearer firebase-token", "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "test.png", title: "TEST image", contentType: "image/png", altText: "TEST image", dataBase64: "iVBORw0KGgo=" })
    }), env());
    const data = await response.json();
    assert.equal(response.status, 403);
    assert.equal(data.code, "wordpress_upload_files_capability_missing");
    assert.match(data.error, /missing the upload_files capability/);
    assert.deepEqual(calls, ["/wp-json/wp/v2/users/me"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("cPanel diagnostics read email accounts, SSL hosts and PHP limits without writes", async () => {
  const router = makeRouter();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async input => {
    const url = new URL(input instanceof URL ? input.href : String(input));
    calls.push(url.pathname);
    const payload = url.pathname.endsWith("/Email/list_pops")
      ? { status: 1, data: [{ email: "info@staging.irpa.or.tz" }, { email: "contact@staging.irpa.or.tz" }] }
      : url.pathname.endsWith("/SSL/installed_hosts")
        ? { status: 1, data: [{ domain: "staging.irpa.or.tz", status: "valid", issuer: "TEST CA" }] }
        : url.pathname.endsWith("/LangPHP/php_ini_get_user")
          ? { status: 1, data: [{ upload_max_filesize: "32M", post_max_size: "40M" }] }
          : null;
    if (!payload) throw new Error("Unexpected cPanel operation: " + url.pathname);
    return makeResponse(payload);
  };
  try {
    const response = await router(new Request("https://gateway.test/api/communications/cpanel/diagnostics?domain=staging.irpa.or.tz", { headers: { Authorization: "Bearer firebase-token" } }), env({
      CPANEL_BASE_URL: "https://cpanel.example.test:2083", CPANEL_USERNAME: "testcp", CPANEL_API_TOKEN: "test-token", CPANEL_DOCUMENT_ROOT: "public_html/staging"
    }));
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.readOnly, true);
    assert.deepEqual(data.emailAccounts.accounts, ["info@staging.irpa.or.tz", "contact@staging.irpa.or.tz"]);
    assert.equal(data.ssl.hosts[0].status, "valid");
    assert.equal(data.phpLimits.upload_max_filesize, "32M");
    assert.equal(data.phpLimits.post_max_size, "40M");
    assert.deepEqual(calls, ["/execute/Email/list_pops", "/execute/SSL/installed_hosts", "/execute/LangPHP/php_ini_get_user"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("401 WordPress JSON codes produce a specific credential finding and sanitized raw response", async () => {
  const router = makeRouter();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof URL ? input.href : String(input));
    if (url.pathname === "/wp-json/wp/v2/users/me") {
      return makeResponse({ code: "incorrect_password", message: "The application password is incorrect." }, 401, {
        "Content-Type": "application/json; charset=UTF-8", "WWW-Authenticate": 'Basic realm="WordPress"'
      });
    }
    if (url.pathname === "/wp-json/") return makeResponse({ name: "IRPA staging" });
    throw new Error("Unexpected request");
  };
  try {
    const response = await status(router, env());
    const data = (await response.json()).connections;
    assert.equal(data.website, "authentication_failed");
    assert.equal(data.websiteDiagnosticCode, "incorrect_password");
    assert.match(data.websiteDiagnosticMessage, /username or Application Password/);
    assert.equal(data.websiteWwwAuthenticatePresent, true);
    assert.equal(data.websiteResponseType, "application/json");
    assert.match(data.websiteRawResponse, /incorrect_password/);
    assert.equal(JSON.stringify(data).includes(APP_PASSWORD), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auth redirects are not followed and are surfaced as a canonical-host finding", async () => {
  const router = makeRouter();
  const originalFetch = globalThis.fetch;
  let authCalls = 0;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof URL ? input.href : String(input));
    if (url.pathname === "/wp-json/wp/v2/users/me") {
      authCalls++;
      return new Response(null, { status: 301, headers: { Location: "https://www.staging.irpa.or.tz/wp-json/wp/v2/users/me?context=edit" } });
    }
    if (url.pathname === "/wp-json/") return makeResponse({ name: "IRPA staging" });
    throw new Error("Unexpected request");
  };
  try {
    const response = await status(router, env());
    const data = (await response.json()).connections;
    assert.equal(data.websiteDiagnosticCode, "unexpected_redirect");
    assert.equal(data.websiteRedirectCount, 1);
    assert.match(data.websiteRedirectTarget, /^https:\/\/www\.staging\.irpa\.or\.tz/);
    assert.equal(authCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("empty non-WordPress 401 response is classified as likely Authorization stripping or WAF interception", async () => {
  const router = makeRouter();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof URL ? input.href : String(input));
    if (url.pathname === "/wp-json/wp/v2/users/me") return new Response(null, { status: 401, headers: { "Content-Type": "text/html" } });
    if (url.pathname === "/wp-json/") return makeResponse({ name: "IRPA staging" });
    throw new Error("Unexpected request");
  };
  try {
    const response = await status(router, env());
    const data = (await response.json()).connections;
    assert.equal(data.websiteDiagnosticCode, "authentication_rejected_empty_body");
    assert.match(data.websiteDiagnosticMessage, /Authorization header may be stripped/);
    assert.equal(data.websiteRawResponse, "(empty response body)");
    assert.equal(data.websiteResponseType, "text/html");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("staging host-guard rejection is classified separately from a WordPress HTTP 401", async () => {
  const router = makeRouter();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("WordPress must not be contacted when the host guard blocks"); };
  try {
    const response = await status(router, env({ WORDPRESS_BASE_URL: "https://www.irpa.or.tz" }));
    const data = (await response.json()).connections;
    assert.equal(data.workerEnvironment, "staging");
    assert.equal(data.configuredWordPressHost, "www.irpa.or.tz");
    assert.equal(data.websiteHostGuardBlocked, true);
    assert.equal(data.websiteDiagnosticCategory, "irpa_host_guard");
    assert.equal(data.websiteDiagnosticCode, "wordpress_host_not_allowed_for_environment");
    assert.equal(data.websiteHttpStatus, undefined);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
