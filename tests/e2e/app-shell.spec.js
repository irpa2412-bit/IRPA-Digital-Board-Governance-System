import { test, expect } from "@playwright/test";

test("desktop production app shell boots without uncaught browser exceptions", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/");
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.locator("body")).not.toContainText("The workspace encountered a startup error.");
  await expect(page).toHaveTitle(/IRPA/i);
  await page.screenshot({ path: "test-results/irpa-app-shell-desktop.png", fullPage: true });

  expect(pageErrors, "uncaught browser exceptions during desktop initial render").toEqual([]);
});

test("mobile production app shell fits a narrow viewport without uncaught exceptions", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/");
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page).toHaveTitle(/IRPA/i);
  await page.screenshot({ path: "test-results/irpa-app-shell-mobile.png", fullPage: true });

  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth, "mobile page should not overflow horizontally").toBeLessThanOrEqual(390);
  expect(pageErrors, "uncaught browser exceptions during mobile initial render").toEqual([]);
});
