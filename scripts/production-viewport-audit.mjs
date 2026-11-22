#!/usr/bin/env node
/**
 * Live production viewport audit for the IRPA Digital Board Governance System.
 *
 * Usage:
 *   node scripts/production-viewport-audit.mjs login
 *   node scripts/production-viewport-audit.mjs audit
 *
 * Login mode is deliberately manual and headed. It never reads, prints, uploads,
 * or commits credentials. The generated auth.json is ignored by Git.
 * Audit mode uses the saved Playwright storage state and the real live site.
 */
import { chromium } from "playwright";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const LIVE_URL = process.env.IRPA_LIVE_URL || "https://irpa-digital-board-governance.web.app/";
const AUTH_FILE = resolve(process.cwd(), "auth.json");
const REPORT_FILE = resolve(process.cwd(), "production-viewport-audit.json");
const WIDTHS = [360, 390, 768, 1024, 1366, 1920];

// Audit exactly 15 primary portals. These names match the production navigation.
// The script uses the application's real navigation controls rather than inventing
// or enabling hash routes; this app's portal selection is React-state navigation.
const PORTALS = [
  "Dashboard",
  "Induction and Orientation",
  "Board Members Registration",
  "Members & Personnel",
  "Invitations",
  "Meetings",
  "Resolutions",
  "Voting",
  "Actions",
  "Documents",
  "Signature Platform",
  "Decisions",
  "Risk Register",
  "Authorization & Approvals",
  "Grant Intelligence & Funding Opportunities"
];

const mode = process.argv[2];
if (!["login", "audit"].includes(mode)) {
  console.error("Usage: node scripts/production-viewport-audit.mjs <login|audit>");
  process.exit(2);
}

async function manualLogin() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  try {
    const response = await page.goto(LIVE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (!response || response.status() !== 200) {
      throw new Error(`Live site did not return HTTP 200 (received ${response?.status() ?? "no response"}).`);
    }
    console.log("A visible browser is open on the LIVE production site.");
    console.log("Sign in manually, complete MFA if requested, and wait until the authorised workspace is visible.");
    console.log("Do not share credentials. This script does not read or print form values.");
    const rl = createInterface({ input: stdin, output: stdout });
    await rl.question("When you can see the authorised workspace, return here and press ENTER to save the session… ");
    rl.close();

    const authenticated = await page.evaluate(() => {
      const text = (document.body?.innerText || "").toLowerCase();
      const authInputs = [...document.querySelectorAll('input[type="password"], input[type="email"]')]
        .some(el => el.getClientRects().length > 0);
      const loginVisible = authInputs && /sign in|log in|password|forgot password/.test(text);
      const appVisible = Boolean(document.querySelector("#root")?.children.length) &&
        !loginVisible && !/access denied|unable to verify irpa authorization/.test(text);
      return { appVisible, loginVisible };
    });
    if (!authenticated.appVisible || authenticated.loginVisible) {
      throw new Error("The authorised workspace was not detected. Complete login/MFA and try again; auth.json was not written.");
    }

    await context.storageState({ path: AUTH_FILE });
    console.log("Session saved to auth.json. Its contents were not printed.");
    console.log("Keep this file private; it is excluded by .gitignore.");
  } finally {
    await context.close();
    await browser.close();
  }
}

async function navigateToPortal(page, portal) {
  // The live app currently switches portal content through its own navigation UI,
  // not by assigning arbitrary hash routes. Use an exact visible navigation label.
  const candidates = [
    page.getByRole("button", { name: portal, exact: true }),
    page.getByRole("link", { name: portal, exact: true }),
    page.getByRole("option", { name: portal, exact: true })
  ];
  for (const locator of candidates) {
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const item = locator.nth(i);
      if (await item.isVisible().catch(() => false) && await item.isEnabled().catch(() => false)) {
        await item.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(350);
        const visibleText = await page.locator("body").innerText().catch(() => "");
        if (visibleText.includes(portal) || (portal === "Grant Intelligence & Funding Opportunities" && /grant intelligence|funding opportunit/i.test(visibleText))) {
          return { navigated: true, method: "visible-navigation-control" };
        }
      }
    }
  }

  // Support an app-provided hash route only when it is actually declared in the DOM
  // as a link. Never guess a hash path or introduce a production backdoor.
  const href = await page.locator("a").evaluateAll((links, label) => {
    const match = links.find(a => (a.innerText || a.getAttribute("aria-label") || "").trim() === label);
    return match?.getAttribute("href") || null;
  }, portal).catch(() => null);
  if (href?.startsWith("#")) {
    await page.evaluate(hash => { window.location.hash = hash; }, href.slice(1));
    await page.waitForTimeout(350);
    return { navigated: true, method: "existing-hash-link" };
  }
  return { navigated: false, method: "portal-not-exposed-to-current-authority" };
}

async function audit() {
  if (!existsSync(AUTH_FILE)) {
    throw new Error("auth.json is missing. Run login mode first, complete manual authentication, and save the session.");
  }
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: AUTH_FILE });
  const page = await context.newPage();
  const rows = [];
  const navigationResults = [];
  try {
    const response = await page.goto(LIVE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (!response || response.status() !== 200) {
      throw new Error(`Live site did not return HTTP 200 (received ${response?.status() ?? "no response"}).`);
    }
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const sessionValid = await page.evaluate(() => {
      const body = (document.body?.innerText || "").toLowerCase();
      const loginVisible = Boolean(document.querySelector('input[type="password"]')) &&
        /sign in|log in|forgot password/.test(body);
      return Boolean(document.querySelector("#root")?.children.length) && !loginVisible;
    });
    if (!sessionValid) {
      throw new Error("Saved session did not open the authorised production workspace. Re-run login mode; no measurements were fabricated.");
    }

    for (const portal of PORTALS) {
      const nav = await navigateToPortal(page, portal);
      navigationResults.push({ page: portal, ...nav });
      if (!nav.navigated) {
        for (const width of WIDTHS) {
          rows.push({
            page: portal, width, innerWidth: null, scrollWidth: null, status: "FAIL",
            offendingElements: ["NOT MEASURED: portal is not reachable through the current authorised account's production navigation"]
          });
        }
        continue;
      }

      // Allow async portal content, data, and layout to settle before measurements.
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(200);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const measured = await page.evaluate(() => {
          const innerWidth = window.innerWidth;
          const scrollWidth = document.documentElement.scrollWidth;
          const offenders = [...document.querySelectorAll("body *")].map(el => {
            const rect = el.getBoundingClientRect();
            if (!Number.isFinite(rect.right) || rect.right <= innerWidth + 1) return null;
            const css = getComputedStyle(el);
            const name = el.tagName.toLowerCase();
            const id = el.id ? "#" + el.id : "";
            const classes = typeof el.className === "string"
              ? "." + el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".")
              : "";
            const label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || "")
              .replace(/\s+/g, " ").trim().slice(0, 90);
            return {
              element: name + id + classes,
              right: Math.round(rect.right * 100) / 100,
              left: Math.round(rect.left * 100) / 100,
              width: Math.round(rect.width * 100) / 100,
              position: css.position,
              overflowX: css.overflowX,
              label
            };
          }).filter(Boolean).slice(0, 30);
          return { innerWidth, scrollWidth, offendingElements: offenders };
        });
        rows.push({
          page: portal,
          width,
          innerWidth: measured.innerWidth,
          scrollWidth: measured.scrollWidth,
          status: measured.scrollWidth <= measured.innerWidth ? "PASS" : "FAIL",
          offendingElements: measured.offendingElements
        });
      }
    }

    await writeFile(REPORT_FILE, JSON.stringify({
      liveUrl: LIVE_URL,
      generatedAt: new Date().toISOString(),
      widths: WIDTHS,
      portals: PORTALS,
      navigationResults,
      rows
    }, null, 2), { mode: 0o600 });

    console.log("LIVE PRODUCTION VIEWPORT AUDIT");
    console.log("page | width | scrollWidth | innerWidth | result | offending elements (right > innerWidth)");
    for (const row of rows) {
      const offenders = row.offendingElements.length
        ? row.offendingElements.map(x => typeof x === "string" ? x : `${x.element} right=${x.right}px (${x.label})`).join("; ")
        : "none";
      console.log(`${row.page} | ${row.width} | ${row.scrollWidth ?? "N/A"} | ${row.innerWidth ?? "N/A"} | ${row.status} | ${offenders}`);
    }
    const failures = rows.filter(row => row.status !== "PASS");
    console.log(`\nSummary: ${rows.length} measurements; ${rows.length - failures.length} PASS; ${failures.length} FAIL.`);
    console.log(`Full JSON report: ${REPORT_FILE}`);
    if (rows.length !== 90 || failures.length) process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

try {
  if (mode === "login") await manualLogin();
  else await audit();
} catch (error) {
  console.error(`Viewport audit failed: ${error.message}`);
  process.exitCode = 1;
}
