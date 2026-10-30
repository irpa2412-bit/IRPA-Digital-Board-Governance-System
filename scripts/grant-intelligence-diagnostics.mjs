import { chromium } from "playwright";
import fs from "node:fs";

const results = [];
const failures = [];
const missing = [];
const timeout = 95000;
const keys = {
  staging: "AIzaSyA6UmHtP-mRr99rBw57_-qrD4_mFSBnZ38",
  production: "AIzaSyC2aMdxHD14nMnGiRyf4mSL1ixXdzBoOtE"
};
const targets = [
  { name: "staging", worker: "https://irpa-grant-crawler-staging.irpa-governance.workers.dev", app: process.env.STAGING_APP_URL, email: process.env.STAGING_TEST_EMAIL, password: process.env.STAGING_TEST_PASSWORD, project: "irpa-dbg-staging-a73ec", apiKey: keys.staging },
  { name: "production", worker: "https://irpa-grant-crawler-production.irpa-governance.workers.dev", app: "https://irpa-digital-board-governance.web.app", email: process.env.PRODUCTION_TEST_EMAIL, password: process.env.PRODUCTION_TEST_PASSWORD, project: "irpa-digital-board-governance", apiKey: keys.production }
];
const record = (target, item, status, evidence, fixed = "N/A") => {
  const row = { target, item, status, evidence, fixed };
  results.push(row);
  if (status === "FAIL") failures.push(row);
};
const need = (name) => {
  const value = process.env[name];
  if (!value) missing.push(name);
  return value || "";
};
async function signIn(target) {
  if (!target.email || !target.password) return null;
  const response = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + target.apiKey, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: target.email, password: target.password, returnSecureToken: true }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.idToken) throw new Error("Firebase sign-in HTTP " + response.status + ": " + (data.error?.message || "no ID token"));
  return data.idToken;
}
async function requestCheck(target, route, method, token, body) {
  const started = Date.now();
  const headers = { accept: "application/json" };
  if (token) headers.authorization = "Bearer " + token;
  if (body !== undefined) headers["content-type"] = "application/json";
  let response;
  try {
    response = await fetch(target.worker + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    record(target.name, method + " " + route, "FAIL", "Network/timeout: " + error.message);
    return { response: null, parsed: null, raw: "" };
  }
  const raw = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {}
  const valid = !!parsed && typeof parsed === "object";
  record(target.name, method + " " + route, response.ok && valid ? "PASS" : "FAIL",
    "HTTP " + response.status + "; JSON=" + valid + "; " + (Date.now() - started) + "ms" + (parsed?.error ? "; " + parsed.error : ""));
  return { response, parsed, raw };
}
async function corsCheck(target, route, method) {
  const started = Date.now();
  try {
    const response = await fetch(target.worker + route, { method: "OPTIONS", headers: {
      origin: target.app || "https://irpa-digital-board-governance.web.app",
      "access-control-request-method": method,
      "access-control-request-headers": "authorization,content-type"
    }, signal: AbortSignal.timeout(12000) });
    const allowOrigin = response.headers.get("access-control-allow-origin");
    const allowMethods = response.headers.get("access-control-allow-methods") || "";
    const allowHeaders = response.headers.get("access-control-allow-headers") || "";
    const ok = response.status === 204 && !!allowOrigin && (allowOrigin === "*" || allowOrigin === target.app) && allowMethods.includes(method) && /authorization/i.test(allowHeaders) && /content-type/i.test(allowHeaders);
    record(target.name, "OPTIONS " + route, ok ? "PASS" : "FAIL", "HTTP " + response.status + "; allow-origin=" + (allowOrigin || "missing") + "; methods=" + allowMethods + "; headers=" + allowHeaders + "; " + (Date.now() - started) + "ms");
  } catch (error) { record(target.name, "OPTIONS " + route, "FAIL", error.message); }
}
async function apiSuite(target) {
  const credentialNames = target.name === "staging" ? ["STAGING_TEST_EMAIL", "STAGING_TEST_PASSWORD"] : ["PRODUCTION_TEST_EMAIL", "PRODUCTION_TEST_PASSWORD"];
  const health = await requestCheck(target, "/health", "GET");
  const expectedEnvironment = target.name === "staging" ? "staging" : "production";
  const healthOk = health.parsed?.service === "irpa-grant-crawler" && health.parsed?.environment === expectedEnvironment && health.parsed?.storage === "configured" && health.parsed?.ai === "configured";
  record(target.name, "Worker environment and bindings", healthOk ? "PASS" : "FAIL", JSON.stringify({ service: health.parsed?.service, environment: health.parsed?.environment, storage: health.parsed?.storage, ai: health.parsed?.ai }));
  for (const [route, method] of [["/health","GET"],["/opportunities","GET"],["/fundraising/search","POST"],["/assistant/analyze","POST"],["/run","POST"]]) await corsCheck(target, route, method);
  if (!target.email || !target.password) {
    for (const name of credentialNames) if (!process.env[name]) need(name);
    const controlToken = process.env.GRANT_CRAWLER_CONTROL_TOKEN || "";
    if (controlToken.length >= 32) {
      await requestCheck(target, "/fundraising/search", "POST", controlToken, { query: "rangeland restoration", mode: "all" });
      const assistant = await requestCheck(target, "/assistant/analyze", "POST", controlToken, {
        task: "draft_message", format: "Partnership request message", tone: "Professional and persuasive", length: "Concise",
        instructions: "Draft a first-contact partnership request to CJRF about suitable funding pathways for IRPA's community-led climate resilience and regenerative rangeland work in Longido, Tanzania. Do not claim implementation history or secured funding.",
        context: "IRPA is an early-stage Tanzanian NGO with three pillars: Sustainable Rangeland Management, Livestock Development and Market Development."
      });
      if (assistant.parsed && typeof assistant.parsed.draft === "string" && assistant.parsed.draft.trim().length > 80) {
        record(target.name, "CJRF AI draft content (crawler control auth)", "PASS", assistant.parsed.draft.length + " characters returned.");
      } else if (assistant.response?.ok) {
        record(target.name, "CJRF AI draft content (crawler control auth)", "FAIL", "Assistant returned HTTP success but no usable draft field.");
      }
    }
    record(target.name, "Firebase-protected Worker routes", "SKIP", "Missing Firebase test credentials; Firebase-only routes and authenticated portal browser tests not run. Control-token-protected search and assistant checks are run independently when available.");
    return;
  }
  let token;
  try { token = await signIn(target); record(target.name, "Firebase authentication", "PASS", "Firebase ID token issued; token value withheld."); }
  catch (error) { record(target.name, "Firebase authentication", "FAIL", error.message); return; }
  await requestCheck(target, "/opportunities", "GET", token);
  await requestCheck(target, "/fundraising/search", "POST", token, { query: "rangeland restoration", mode: "all" });
  const assistant = await requestCheck(target, "/assistant/analyze", "POST", token, {
    task: "draft_message", format: "Partnership request message", tone: "Professional and persuasive", length: "Concise",
    instructions: "Draft a first-contact partnership request to the Climate Justice Resilience Fund (CJRF) asking about suitable funding pathways for IRPA's community-led climate resilience and regenerative rangeland work in Longido, Tanzania. Do not assume a call is open, invent project implementation history, claim secured funding, or invent figures.",
    context: "IRPA is an early-stage Tanzanian NGO. Its pillars are Sustainable Rangeland Management, Livestock Development and Market Development. Request guidance on eligibility and future funding windows."
  });
  if (assistant.parsed && typeof assistant.parsed.draft === "string" && assistant.parsed.draft.trim().length > 80) {
    record(target.name, "CJRF AI draft content", "PASS", "Non-empty draft returned; " + assistant.parsed.draft.length + " characters.");
  } else if (assistant.response?.ok) {
    record(target.name, "CJRF AI draft content", "FAIL", "Assistant returned HTTP success but no usable draft field.");
  }
  if (target.name === "staging") await requestCheck(target, "/run", "POST", token, { mode: "scheduled" });
  else record(target.name, "POST /run", "SKIP", "Production crawler refresh intentionally not executed (read-only production rule).");
}
async function login(page, target) {
  await page.goto(target.app, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(5000);
  if (await page.locator('input[type="email"]').count()) {
    await page.locator('input[type="email"]').first().fill(target.email);
    await page.locator('input[type="password"]').first().fill(target.password);
    const button = page.getByRole("button", { name: /sign in|log in|login/i }).first();
    await button.click({ timeout: 15000 });
    await page.waitForTimeout(9000);
  }
  const search = page.getByRole("textbox", { name: "Search opportunities" });
  if (!(await search.isVisible().catch(() => false))) {
    const heading = page.locator(".topbar-title-line h2").filter({ hasText: "Grant Intelligence & Funding Opportunities" });
    let clickedVisibleNavigation = false;
    if (page.viewportSize().width < 700) {
      const portalsButton = page.getByRole("button", { name: "Portals", exact: true });
      if (await portalsButton.isVisible().catch(() => false)) await portalsButton.click();
      const navigation = page.getByRole("dialog", { name: "Mobile navigation" });
      const targetButton = navigation.getByRole("button", { name: "Grant Intelligence & Funding Opportunities", exact: true }).first();
      if (await targetButton.isVisible().catch(() => false)) {
        await targetButton.click();
        clickedVisibleNavigation = true;
      }
    } else {
      const targetButton = page.getByRole("button", { name: "Grant Intelligence & Funding Opportunities", exact: true }).first();
      if (await targetButton.isVisible().catch(() => false)) {
        await targetButton.click();
        clickedVisibleNavigation = true;
      }
    }
    if (clickedVisibleNavigation) await heading.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    if (!(await heading.isVisible().catch(() => false))) {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("irpa:navigate", { detail: { module: "Grant Intelligence & Funding Opportunities" } })));
    }
    await heading.waitFor({ state: "visible", timeout: 25000 });
    await search.waitFor({ state: "visible", timeout: 25000 });
  }
  if (!(await search.isVisible().catch(() => false))) {
    const body = (await page.locator("body").innerText()).slice(0, 1200);
    throw new Error("Grant Intelligence page not visible after visible-nav click and irpa:navigate fallback: " + body);
  }
}
async function browserSuite(target) {
  const credentialNames = target.name === "staging" ? ["STAGING_APP_URL","STAGING_TEST_EMAIL","STAGING_TEST_PASSWORD"] : ["PRODUCTION_TEST_EMAIL","PRODUCTION_TEST_PASSWORD"];
  if (!target.app || !target.email || !target.password) {
    for (const name of credentialNames) if (!process.env[name]) need(name);
    if (target.name === "production" && (!target.email || !target.password)) {
      record(target.name, "Authenticated Playwright", "SKIPPED (no production test login)", "Production portal browser tests skipped because a production test email or password was not supplied. Read-only production Worker route checks continue independently.");
    } else {
      record(target.name, "Authenticated Playwright", "SKIP", "Missing app URL or staging login credentials; dependent browser tests not run.");
    }
    return;
  }
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const failed = [];
  const httpErrors = [];
  const warnings = [];
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.on("console", message => {
        if (message.type() !== "error") return;
        const location = message.location();
        const source = location.url || "unknown";
        const line = message.text() + " [source=" + source + ":" + (location.lineNumber || 0) + "]";
        if (/\/api\/auth\/password-attempt-state(?:$|\?)/.test(source)) warnings.push("Optional dashboard password-security endpoint (not Grant Intelligence): " + line);
        else errors.push(line);
      });
      page.on("pageerror", error => errors.push(error.message));
      page.on("response", response => {
        if (response.status() < 400) return;
        const url = response.url();
        if (response.status() === 404 && /\/api\/auth\/password-attempt-state(?:$|\?)/.test(url)) warnings.push("HTTP 404 from optional dashboard password-security endpoint (not Grant Intelligence): " + url);
        else httpErrors.push("HTTP " + response.status() + " " + url);
      });
      page.on("requestfailed", request => {
        const url = request.url();
        const reason = request.failure()?.errorText || "";
        const parsedUrl = (() => { try { return new URL(url); } catch { return null; } })();
        const abortedFirestoreListen = parsedUrl?.hostname === "firestore.googleapis.com" && parsedUrl.pathname.includes("/google.firestore.v1.Firestore/Listen/channel") && /ERR_ABORTED/i.test(reason);
        if (abortedFirestoreListen) warnings.push("Ignored aborted Firestore Listen/channel request: " + parsedUrl.origin + parsedUrl.pathname);
        else failed.push(request.method() + " " + url + " " + reason);
      });
      try {
      await login(page, target);
      const webCommit = await page.locator('meta[name=irpa-build-version]').getAttribute('content').catch(() => 'unavailable');
      record(target.name, 'Live web build commit ' + width + 'px', webCommit && webCommit !== 'unavailable' ? 'PASS' : 'FAIL', webCommit || 'Build stamp unavailable.');
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      const noOverflow = dimensions.scroll <= dimensions.width + 1 && dimensions.body <= dimensions.width + 1;
      record(target.name, "Page layout " + width + "px", noOverflow ? "PASS" : "FAIL", JSON.stringify(dimensions));
      const search = page.getByRole("textbox", { name: "Search opportunities" });
      await search.fill("__IRPA_DIAGNOSTIC_NO_MATCH_20261030__");
      await page.waitForTimeout(700);
      const emptySearchState = await page.getByText("No matching opportunities yet").count();
      record(target.name, "Opportunity search " + width + "px", emptySearchState > 0 ? "PASS" : "FAIL", "Unique query produced " + emptySearchState + " no-match state(s).");
      await search.fill("");
      const selects = page.locator(".grant-intelligence-portal select");
      const count = await selects.count();
      let exercised = 0;
      for (let i = 0; i < count; i++) {
        const select = selects.nth(i);
        const values = await select.locator("option").evaluateAll(options => options.map(o => o.value));
        const candidate = values.find(value => value !== "all");
        if (candidate) {
          await select.selectOption(candidate);
          if (await select.inputValue() === candidate) exercised++;
          await select.selectOption("all").catch(() => {});
        }
      }
      record(target.name, "Opportunity filters " + width + "px", count >= 3 && exercised >= 3 ? "PASS" : "FAIL", exercised + "/" + count + " pillar/theme/status filters accepted and reset.");
      if (target.name === "staging" && width === 1440) {
        const request = page.getByRole("textbox", { name: "AI Assistant request" });
        const draftRequest = "Draft a concise first-contact partnership request to the Climate Justice Resilience Fund (CJRF) about suitable funding pathways for IRPA's community-led climate resilience and regenerative rangeland work in Longido, Tanzania. Do not claim previous project delivery or secured funding.";
        await request.fill(draftRequest);
        // The institutional data-entry gate must be completed through its real UI before generating a draft.
        const fieldGate = page.locator('[data-irpa-field-gate][role="dialog"]');
        if (await fieldGate.isVisible().catch(() => false)) {
          await fieldGate.locator('input[name="irpa-data-type"][value="other"]').check();
          await fieldGate.locator('input[name="irpa-data-environment"][value="TRIAL"]').check();
          const confirmGate = fieldGate.getByRole("button", { name: "Confirm environment and continue" });
          await confirmGate.waitFor({ state: "visible", timeout: 10000 });
          await confirmGate.click();
          await fieldGate.waitFor({ state: "hidden", timeout: 10000 });
          await request.fill(draftRequest);
        }
        await page.getByRole("button", { name: "Generate requested output" }).click();
        await page.getByRole("textbox", { name: "Editable AI output" }).waitFor({ state: "visible", timeout: 100000 });
        const draft = await page.getByRole("textbox", { name: "Editable AI output" }).inputValue();
        record(target.name, "AI Assistant CJRF browser draft", draft.length > 80 ? "PASS" : "FAIL", draft.length + " characters returned.");
      }
      } catch (error) {
        record(target.name, "Playwright viewport " + width + "px", "FAIL", error.message);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } catch (error) { record(target.name, "Playwright browser launch", "FAIL", error.message); }
  finally {
    record(target.name, "Browser console errors", errors.length ? "FAIL" : "PASS", errors.length ? errors.join(" | ").slice(0, 1800) : "No unexpected console errors.");
    record(target.name, "Failed network calls", failed.length ? "FAIL" : "PASS", failed.length ? failed.join(" | ").slice(0, 1800) : "No unexpected failed requests.");
    record(target.name, "Browser HTTP error responses", httpErrors.length ? "FAIL" : "PASS", httpErrors.length ? httpErrors.join(" | ").slice(0, 2400) : "No unexpected HTTP responses >= 400.");
    record(target.name, "Unrelated dashboard service warnings", "INFO", warnings.length ? warnings.join(" | ").slice(0, 2400) : "No unrelated dashboard service warnings.");
    await browser.close();
  }
}
async function versions() {
  const token = need("CLOUDFLARE_GRANT_CRAWLER_API_TOKEN"), account = need("CLOUDFLARE_ACCOUNT_ID");
  if (!token || !account) { record("both", "Worker version metadata", "SKIP", "Missing Cloudflare API credentials; no version data retrieved."); return; }
  for (const target of targets) {
    const script = target.name === "staging" ? "irpa-grant-crawler-staging" : "irpa-grant-crawler-production";
    try {
      const response = await fetch("https://api.cloudflare.com/client/v4/accounts/" + account + "/workers/scripts/" + script + "/deployments", { headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(15000) });
      const data = await response.json().catch(() => ({}));
      const deployments = Array.isArray(data.result?.deployments) ? data.result.deployments : [];
      const deployment = deployments[0];
      const version = deployment?.versions?.map(item => item.version_id + "@" + item.percentage + "%").join(", ") || "unavailable";
      const apiErrors = Array.isArray(data.errors) ? data.errors.map(item => item.message || item.code).join("; ") : "";
      const valid = response.ok && data.success === true && !!deployment && Array.isArray(deployment.versions) && deployment.versions.length > 0;
      record(target.name, "Active Worker deployment version", valid ? "PASS" : "FAIL", "HTTP " + response.status + "; success=" + String(data.success) + "; deployments=" + deployments.length + "; deployment=" + (deployment?.id || "unavailable") + "; versions=" + version + (apiErrors ? "; API errors=" + apiErrors : ""));
    } catch (error) { record(target.name, "Worker version", "FAIL", error.message); }
  }
  record("build", "Diagnostic web commit", "PASS", process.env.DIAGNOSTIC_BUILD_COMMIT || "unknown");
}
if (process.env.DIAGNOSTIC_BROWSER_ONLY) {
  const target = targets.find(item => item.name === process.env.DIAGNOSTIC_BROWSER_ONLY);
  if (!target) throw new Error("Unknown DIAGNOSTIC_BROWSER_ONLY target: " + process.env.DIAGNOSTIC_BROWSER_ONLY);
  await browserSuite(target);
} else {
  for (const target of targets) {
    try { await apiSuite(target); } catch (error) { record(target.name, "Worker API suite", "FAIL", error.message); }
    try { await browserSuite(target); } catch (error) { record(target.name, "Browser suite", "FAIL", error.message); }
  }
  await versions();
}
console.log("\nGRANT_INTELLIGENCE_DIAGNOSTIC_RESULTS");
for (const row of results) console.log(JSON.stringify(row));
console.log("\nMISSING_SECRETS_BY_NAME=" + [...new Set(missing)].join(","));
console.log("FAILURE_COUNT=" + failures.length);
if (failures.length) process.exitCode = 1;
