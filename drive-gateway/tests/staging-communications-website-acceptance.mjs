import { assertStagingWebsiteHost, redactSecrets } from "../src/communicationsWebsitePolicy.mjs";

const rows = [];
const check = (name, ok, detail = "") => rows.push({ name, result: ok ? "PASS" : "FAIL", detail: String(detail).replace(/[\r\n|]/g, " ").slice(0, 180) });
const env = process.env;
let failed = false;
try {
  assertStagingWebsiteHost(env.STAGING_WORDPRESS_BASE_URL);
  check("Target is HTTPS staging.irpa.or.tz", true);
} catch (error) {
  check("Target is HTTPS staging.irpa.or.tz", false, error.message);
  failed = true;
}
if (!env.STAGING_GATEWAY_URL || !env.STAGING_FIREBASE_WEB_API_KEY || !env.STAGING_TEST_EMAIL || !env.STAGING_TEST_PASSWORD) {
  check("Staging credentials configured", false, "Required staging-only Actions secrets are missing.");
  failed = true;
} else {
  check("Staging credentials configured", true);
}
const gateway = String(env.STAGING_GATEWAY_URL || "");
try {
  const url = new URL(gateway);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".workers.dev") || /irpa\.or\.tz$/i.test(url.hostname)) throw new Error("Gateway must be the HTTPS staging Worker workers.dev hostname.");
  check("Gateway hostname is staging Worker", true);
} catch (error) {
  check("Gateway hostname is staging Worker", false, error.message);
  failed = true;
}
if (!failed) {
  try {
    const authResponse = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + encodeURIComponent(env.STAGING_FIREBASE_WEB_API_KEY), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: env.STAGING_TEST_EMAIL, password: env.STAGING_TEST_PASSWORD, returnSecureToken: true })
    });
    const auth = await authResponse.json().catch(() => ({}));
    if (!authResponse.ok || !auth.idToken) throw new Error("Staging Firebase authentication failed (HTTP " + authResponse.status + ").");
    const headers = { Authorization: "Bearer " + auth.idToken, Accept: "application/json" };
    const statusResponse = await fetch(gateway + "/api/communications/site/status", { headers });
    const status = await statusResponse.json().catch(() => ({}));
    check("Authenticated website/cPanel status route", statusResponse.ok && status.ok === true, "HTTP " + statusResponse.status);
    for (const type of ["pages", "posts"]) {
      const response = await fetch(gateway + "/api/communications/website/content?type=" + type, { headers });
      const data = await response.json().catch(() => ({}));
      check("Read staging WordPress " + type, response.ok && Array.isArray(data.items), "HTTP " + response.status);
    }
    const denied = await fetch(gateway + "/api/communications/website/content?type=pages");
    check("Unauthenticated role denial", denied.status === 401 || denied.status === 403, "HTTP " + denied.status);
    const secretProbe = "Authorization: Bearer " + auth.idToken + " WORDPRESS_APPLICATION_PASSWORD=" + env.STAGING_TEST_PASSWORD + " API_KEY=" + env.STAGING_FIREBASE_WEB_API_KEY;
    const serialized = redactSecrets(secretProbe, [auth.idToken, env.STAGING_FIREBASE_WEB_API_KEY, env.STAGING_TEST_PASSWORD]);
    check("Response diagnostic secret redaction", !serialized.includes(auth.idToken) && !serialized.includes(env.STAGING_TEST_PASSWORD) && !serialized.includes(env.STAGING_FIREBASE_WEB_API_KEY) && serialized.includes("[REDACTED]"));
  } catch (error) {
    check("Staging runtime acceptance", false, error.message);
  }
}
const firstFailure = rows.find(row => row.result === "FAIL");
console.log("WEBSITE PORTAL VERDICT: " + (firstFailure ? "FAIL (" + firstFailure.name + ")" : "PASS"));
console.log("| Check | PASS or FAIL | Exact error (first 300 characters, redacted) |");
console.log("|---|---|---|");
for (const row of rows) console.log("| " + row.name + " | " + row.result + " | " + redactSecrets(row.detail, [env.STAGING_TEST_PASSWORD, env.STAGING_FIREBASE_WEB_API_KEY].filter(Boolean)).slice(0, 300).replace(/\|/g, "/") + " |");
if (firstFailure) process.exitCode = 1;
