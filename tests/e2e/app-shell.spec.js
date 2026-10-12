import { test, expect } from "@playwright/test";

test("production app shell boots and renders visible content", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.locator("body")).not.toContainText("The workspace encountered a startup error.");
  await expect(page).toHaveTitle(/IRPA/i);

  await page.screenshot({
    path: "test-results/irpa-app-shell.png",
    fullPage: true
  });

  expect(pageErrors, "uncaught browser exceptions during initial render").toEqual([]);
});
