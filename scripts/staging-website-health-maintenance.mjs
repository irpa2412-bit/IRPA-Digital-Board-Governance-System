import { setTimeout as delay } from "node:timers/promises";

const env = process.env;
const gateway = String(env.STAGING_GATEWAY_URL || "https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev").replace(/\/+$/, "");
const base = String(env.STAGING_WORDPRESS_BASE_URL || "").replace(/\/+$/, "");
const checks = [];
const secrets = [env.STAGING_FIREBASE_WEB_API_KEY, env.STAGING_TEST_PASSWORD].filter(Boolean);
const clean = value => String(value ?? "").replace(/[\r\n\t]/g, " ").replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]").slice(0, 240);
function record(name, ok, detail) { checks.push({ name, result: ok ? "PASS" : "FAIL", detail: clean(detail) }); }
async function request(url, options = {}, attempts = 3) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
      const raw = await response.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if (response.ok) return { response, data, raw };
      last = new Error("HTTP " + response.status + " " + clean(data.error || data.message || raw.slice(0, 150)));
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) { last = error; }
    if (attempt < attempts) await delay(attempt * 1500);
  }
  throw last || new Error("Request failed");
}
function assertStagingBase() {
  const url = new URL(base);
  if (url.protocol !== "https:" || url.hostname !== "staging.irpa.or.tz" || url.pathname !== "" && url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
    throw new Error("Refusing non-staging WordPress host.");
  }
}
async function main() {
  if (!base || !env.STAGING_FIREBASE_WEB_API_KEY || !env.STAGING_TEST_EMAIL || !env.STAGING_TEST_PASSWORD) {
    record("Required staging configuration", false, "Missing one or more required staging secret values; values were not printed.");
    return;
  }
  try { assertStagingBase(); record("Production-host guard", true, "HTTPS staging.irpa.or.tz only."); }
  catch (error) { record("Production-host guard", false, error.message); return; }

  let token;
  try {
    const signIn = await request("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + encodeURIComponent(env.STAGING_FIREBASE_WEB_API_KEY), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: env.STAGING_TEST_EMAIL, password: env.STAGING_TEST_PASSWORD, returnSecureToken: true })
    }, 2);
    token = signIn.data.idToken;
    if (!token) throw new Error("Firebase sign-in did not return an ID token.");
    secrets.push(token);
    record("Staging service authentication", true, "Authenticated; credential values suppressed.");
  } catch (error) {
    record("Staging service authentication", false, error.message);
    return;
  }

  const api = async path => request(gateway + path, { headers: { Accept: "application/json", Authorization: "Bearer " + token, "Cache-Control": "no-cache" } }, 3);
  let connections;
  try {
    const { data } = await api("/api/communications/site/status");
    connections = data.connections;
    if (!connections || typeof connections !== "object") throw new Error("Gateway returned no structured site status.");
    record("Staging site status endpoint", true, "Health status retrieved with bounded retries.");
    record("WordPress integration", connections.website === true, connections.website === true ? "Connected." : "Not connected or not verified.");
    record("cPanel integration", connections.cpanel === true, connections.cpanel === true ? "Connected." : "Not connected or not verified.");
    if (connections.websiteUp === false) record("Staging website availability", false, "Staging website reported unavailable.");
    else if (connections.websiteUp === true) record("Staging website availability", true, "Staging website responded.");
    else record("Staging website availability", false, "Availability was not verified.");
    const links = Array.isArray(connections.brokenLinks) ? connections.brokenLinks : null;
    if (links) record("Main navigation links", links.length === 0, links.length === 0 ? "No broken main-menu links reported." : links.length + " broken link(s) reported; no automatic link edits were made.");
    else record("Main navigation links", false, "Link-check result unavailable.");
    const backup = String(connections.lastBackup || "");
    record("Backup status", Boolean(backup && backup !== "not available"), backup && backup !== "not available" ? "Latest backup metadata returned: " + backup : "No recent backup timestamp could be verified; no backup was deleted or overwritten.");
    const ssl = String(connections.sslExpiry || "");
    if (ssl) {
      const expiry = Date.parse(ssl);
      record("SSL expiry", Number.isFinite(expiry) && expiry > Date.now() + 14 * 86400000, Number.isFinite(expiry) ? "Expiry date: " + new Date(expiry).toISOString() : "SSL expiry value was not parseable.");
    } else record("SSL expiry", false, "SSL expiry was not available from the staging status endpoint.");
  } catch (error) {
    record("Staging site status endpoint", false, error.message);
  }

  for (const type of ["pages", "posts"]) {
    try {
      const { data } = await api("/api/communications/website/content?type=" + type);
      if (!Array.isArray(data.items)) throw new Error("Content listing shape was invalid.");
      record("Staging " + type + " read access", true, data.items.length + " item(s) listed; no content was changed.");
    } catch (error) { record("Staging " + type + " read access", false, error.message); }
  }

  const summary = [
    "# Scheduled IRPA staging website health check",
    "",
    "- Checked at: " + new Date().toISOString(),
    "- Target: staging.irpa.or.tz only",
    "- Mode: read-only checks, retry transient failures; no content or configuration mutations",
    "",
    "| Check | Result | Detail |",
    "|---|---|---|",
    ...checks.map(row => "| " + row.name.replace(/\|/g, "\\|") + " | " + row.result + " | " + row.detail.replace(/\|/g, "\\|") + " |"),
    "",
    "Content, SEO, plugin/theme/core updates and website files are never auto-edited by this scheduled job. Content changes require human review and approval in the Communications Portal. Unsupported technical repairs are reported, not guessed."
  ].join("\n");
  console.log(summary);
  if (checks.some(row => row.result === "FAIL")) process.exitCode = 1;
}
await main();
