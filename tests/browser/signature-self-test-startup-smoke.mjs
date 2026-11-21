import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", error => failures.push(viewport.width + "px pageerror: " + error.message));
    page.on("response", response => {
      const url = response.url();
      if (/\/assets\/.*\.js(?:$|\?)/.test(url) && response.status() !== 200) {
        failures.push(viewport.width + "px asset " + response.status() + ": " + url);
      }
    });
    const response = await page.goto("http://127.0.0.1:4174/", { waitUntil: "networkidle", timeout: 30000 });
    assert.equal(response?.status(), 200, "built application document must return HTTP 200");
    await page.waitForFunction(() => {
      const root = document.querySelector("#root");
      return Boolean(root && root.childElementCount > 0);
    }, null, { timeout: 15000 });
    const shell = await page.locator("#root").innerText();
    assert.ok(shell.trim().length > 0, "application shell must render content");
    assert.doesNotMatch(shell, /application failed to start|uncaught exception/i);
    await page.close();
  }
  assert.deepEqual(failures, [], "no startup page errors or failed JavaScript chunks");
} finally {
  await browser.close();
}
