import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const artifactDir = "artifacts/grant-intelligence-diagnostics";
fs.mkdirSync(artifactDir, { recursive: true });

const targets = [
  { name: "staging", app: process.env.STAGING_APP_URL, email: process.env.STAGING_TEST_EMAIL, password: process.env.STAGING_TEST_PASSWORD },
  { name: "production", app: "https://irpa-digital-board-governance.web.app", email: process.env.PRODUCTION_TEST_EMAIL, password: process.env.PRODUCTION_TEST_PASSWORD }
];

const isGrantRoute = value => /grant|fundrais|opportunit|assistant\/analy[sz]e/i.test(value);
const portalHeading = /Grant Intelligence.*Funding Opportunities/i;

async function runTarget(target) {
  const missing = [];
  if (!target.app) missing.push(target.name === "staging" ? "STAGING_APP_URL" : "PRODUCTION_APP_URL");
  if (!target.email) missing.push(target.name === "staging" ? "STAGING_TEST_EMAIL" : "PRODUCTION_TEST_EMAIL");
  if (!target.password) missing.push(target.name === "staging" ? "STAGING_TEST_PASSWORD" : "PRODUCTION_TEST_PASSWORD");
  if (missing.length) {
    console.log("SKIP " + target.name + " browser tests; missing secrets/variables: " + missing.join(", "));
    if (target.name === "staging") throw new Error("Staging browser test prerequisites missing: " + missing.join(", "));
    return;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const routeFailures = [];
      page.on("response", response => {
        const status = response.status();
        if (status !== 404 && status !== 429) return;
        const url = response.url();
        const classification = isGrantRoute(url) ? "FAIL Grant Intelligence route" : "WARNING unrelated dashboard service";
        const line = target.name + " " + status + " " + classification + " URL=" + url;
        console.log(line);
        routeFailures.push({ status, url, grant: isGrantRoute(url) });
      });
      page.on("console", message => {
        if (message.type() === "error") console.log(target.name + " console.error " + message.text());
      });
      let succeeded = false;
      try {
        await page.goto(target.app, { waitUntil: "domcontentloaded", timeout: 45000 });
        const email = page.locator('input[type="email"]').first();
        if (await email.count()) {
          await email.fill(target.email);
          await page.locator('input[type="password"]').first().fill(target.password);
          await page.getByRole("button", { name: /sign in|log in|login/i }).first().click();
        }

        const heading = page.locator(".topbar h2").filter({ hasText: portalHeading });
        const waitForPortal = () => heading.waitFor({ state: "visible", timeout: 12000 });

        // Deterministic primary path: use the visible navigation control.
        try {
          if (width === 390) {
            const portals = page.locator(".mobile-global-nav").getByRole("button", { name: "Portals" });
            if (await portals.isVisible()) {
              await portals.click();
              const dialog = page.getByRole("dialog", { name: "Mobile navigation" });
              await dialog.getByRole("button", { name: /Grant Intelligence.*Funding Opportunities/ }).click();
            } else {
              await page.getByRole("button", { name: /Grant Intelligence.*Funding Opportunities/ }).first().click();
            }
          } else {
            await page.getByRole("button", { name: /Grant Intelligence.*Funding Opportunities/ }).first().click();
          }
          await waitForPortal();
        } catch {
          // Fallback is the application's documented navigation event and payload.
          await page.evaluate(() => window.dispatchEvent(new CustomEvent("irpa:navigate", {
            detail: { module: "Grant Intelligence & Funding Opportunities" }
          })));
          await waitForPortal();
        }

        await page.getByRole("heading", { name: portalHeading }).waitFor({ state: "visible", timeout: 15000 });
        if (routeFailures.some(item => item.grant)) {
          throw new Error("Grant Intelligence route returned HTTP 404/429; see URL diagnostics above.");
        }
        succeeded = true;
        console.log("PASS " + target.name + " Grant Intelligence visible at " + width + "px");
      } catch (error) {
        const stem = target.name + "-" + width + "px";
        const screenshot = path.join(artifactDir, stem + ".png");
        const pageText = path.join(artifactDir, stem + ".txt");
        await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
        const body = await page.locator("body").innerText().catch(() => "Unable to retrieve page text: " + error.message);
        fs.writeFileSync(pageText, body, "utf8");
        console.error("FAIL " + target.name + " Grant Intelligence at " + width + "px: " + error.message);
        console.error("Artifacts: " + screenshot + " ; " + pageText);
        throw error;
      } finally {
        await page.close();
      }
      if (!succeeded) throw new Error("Portal visibility assertion did not complete.");
    }
  } finally {
    await browser.close();
  }
}

for (const target of targets) await runTarget(target);
