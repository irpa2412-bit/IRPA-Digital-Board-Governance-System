import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const viewports = [
  { name: "small-mobile-320", width: 320, height: 740 },
  { name: "mobile-360", width: 360, height: 800 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "tablet-1024", width: 1024, height: 768 },
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "desktop-1440", width: 1440, height: 900 }
];

test("collects portal responsive layout metrics without enforcing thresholds", async ({ page }) => {
  const outputDirectory = resolve("artifacts/portal-responsive-audit");
  mkdirSync(outputDirectory, { recursive: true });
  const results = [];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/portal-layout-fixture.html");
    await expect(page.getByRole("heading", { name: "IRPA Portal Layout Fixture" })).toBeVisible();

    const metrics = await page.evaluate(() => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const visible = element => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const outsideViewport = Array.from(document.querySelectorAll("[data-audit-root] *"))
        .filter(element => visible(element) && !element.closest("[data-audit-scroll-region]"))
        .filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.left < -1 || rect.right > width + 1;
        })
        .slice(0, 20)
        .map(element => ({
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === "string" ? element.className : "",
          right: Math.round(element.getBoundingClientRect().right),
          left: Math.round(element.getBoundingClientRect().left)
        }));
      const undersizedTouchTargets = Array.from(document.querySelectorAll("button, input, select, textarea, a"))
        .filter(visible)
        .filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.height < 44 || rect.width < 44;
        })
        .map(element => ({
          tag: element.tagName.toLowerCase(),
          label: (element.getAttribute("aria-label") || element.textContent || element.getAttribute("placeholder") || "").trim().slice(0, 60),
          width: Math.round(element.getBoundingClientRect().width),
          height: Math.round(element.getBoundingClientRect().height)
        }))
        .slice(0, 30);
      const textCandidates = Array.from(document.querySelectorAll(".topbar-title-block h2, .topbar-access-category, .page-header h1, .panel-header h2"));
      const clippedText = textCandidates
        .filter(visible)
        .filter(element => element.scrollWidth > element.clientWidth + 1)
        .map(element => ({
          selector: element.tagName.toLowerCase() + (typeof element.className === "string" && element.className ? "." + element.className.trim().replaceAll(" ", ".") : ""),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth
        }));
      const tableRegion = document.querySelector("[data-audit-scroll-region]");
      return {
        viewport: { width, height },
        document: {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
        },
        outsideViewportElements: outsideViewport,
        undersizedTouchTargets,
        clippedText,
        containedTableOverflow: tableRegion ? tableRegion.scrollWidth > tableRegion.clientWidth : false
      };
    });

    results.push({ name: viewport.name, ...metrics });
    await page.screenshot({
      path: resolve(outputDirectory, viewport.name + ".png"),
      fullPage: true
    });
  }

  const report = {
    audit: "IRPA portal responsive layout",
    mode: "report-only",
    generatedAt: new Date().toISOString(),
    thresholdsEnforced: false,
    viewportCount: results.length,
    results
  };
  writeFileSync(resolve(outputDirectory, "responsive-audit.json"), JSON.stringify(report, null, 2));
  const overflowCount = results.filter(result => result.document.horizontalOverflow).length;
  const targetCount = results.reduce((sum, result) => sum + result.undersizedTouchTargets.length, 0);
  console.log("REPORT ONLY: " + results.length + " viewports; " + overflowCount + " document overflow findings; " + targetCount + " undersized touch targets. Findings are recorded, not asserted.");
});
