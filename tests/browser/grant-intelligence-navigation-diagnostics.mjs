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

async function runTarget(target) {
  const missing = [];
  if (!target.app) missing.push(target.name === "staging" ? "STAGING_APP_URL" : "PRODUCTION_APP_URL");
  if (!target.email) missing.push(target.name === "staging" ? "STAGING_TEST_EMAIL" : "PRODUCTION_TEST_EMAIL");
  if (!target.password) missing.push(target.name === "staging" ? "STAGING_TEST_PASSWORD" : "PRODUCTION_TEST_PASSWORD");
  if (missing.length) {
    if (target.name === "production") {
      console.log("SKIPPED (no production test login)");
      return;
    }
    if (target.name === "staging" && !target.app) {
      console.log("SKIPPED (staging not configured in production-only browser job)");
      return;
    }
    console.log("SKIP " + target.name + " browser tests; missing secrets/variables: " + missing.join(", "));
    throw new Error("Staging browser test prerequisites missing: " + missing.join(", "));
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

        const heading = page.getByTestId("grant-intelligence-portal-heading");
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

        await heading.waitFor({ state: "visible", timeout: 15000 });
        const headingText = (await heading.innerText()).trim();
        if (headingText !== "Live Grants & Calls for Proposals") throw new Error("Unexpected Grant Intelligence portal heading: " + headingText);
        if (routeFailures.some(item => item.grant)) {
          throw new Error("Grant Intelligence route returned HTTP 404/429; see URL diagnostics above.");
        }
        succeeded = true;
        console.log("PASS " + target.name + " Grant Intelligence visible at " + width + "px");
      } catch (error) {
        const stem = target.name + "-" + width + "px";
        const screenshot = path.join(artifactDir, stem + ".png");
        const pageText = path.join(artifactDir, stem + ".txt");
        const diagnosticsFile = path.join(artifactDir, stem + "-diagnostics.json");
        await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
        const body = await page.locator("body").innerText().catch(() => "Unable to retrieve page text: " + error.message);
        const diagnostics = await page.evaluate(() => {
          const visible = element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          };
          const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible).map(element => ({
            tag: element.tagName.toLowerCase(), role: element.getAttribute("role") || "heading",
            text: (element.innerText || element.textContent || "").trim()
          }));
          const dialogs = [...document.querySelectorAll('[role="dialog"],dialog,[data-irpa-field-gate]')].filter(visible).map(element => ({
            selector: element.hasAttribute("data-irpa-field-gate") ? "[data-irpa-field-gate]" : element.tagName.toLowerCase(),
            text: (element.innerText || element.textContent || "").trim()
          }));
          return { url: location.href, title: document.title, headings, dialogs };
        }).catch(() => ({ url: page.url(), title: "", headings: [], dialogs: [], collectionError: "Unable to inspect DOM" }));
        diagnostics.error = error.message;
        diagnostics.pageText = body;
        fs.writeFileSync(pageText, "URL: " + diagnostics.url + "\\n\\nVisible headings:\\n" + diagnostics.headings.map(h => h.tag + " [" + h.role + "] " + h.text).join("\\n") + "\\n\\nOpen dialogs:\\n" + diagnostics.dialogs.map(d => d.selector + "\\n" + d.text).join("\\n\\n") + "\\n\\nPage text:\\n" + body, "utf8");
        fs.writeFileSync(diagnosticsFile, JSON.stringify(diagnostics, null, 2), "utf8");
        console.error("FAIL " + target.name + " Grant Intelligence at " + width + "px: " + error.message);
        console.error("Failure evidence: URL=" + diagnostics.url + "; headings=" + JSON.stringify(diagnostics.headings) + "; dialogs=" + JSON.stringify(diagnostics.dialogs));
        console.error("Artifacts: " + screenshot + " ; " + pageText + " ; " + diagnosticsFile);
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
