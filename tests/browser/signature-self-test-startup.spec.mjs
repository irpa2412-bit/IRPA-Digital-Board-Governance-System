import { test, expect } from "@playwright/test";

const fixtureEmail = "irpa-browser-fixture-admin@example.test";
const fixturePassword = "FixtureOnly-Password-2026!";

for (const viewport of [
  { name: "android", width: 390, height: 844 },
  { name: "desktop", width: 1366, height: 900 }
]) {
  test("Signature Portal startup remains healthy for clean and mocked signed-in sessions at " + viewport.name, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.route(/\/api\//, route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, results: [] })
    }));

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#root")).not.toBeEmpty();
    await expect(page.getByText("The workspace encountered a startup error.")).toHaveCount(0);
    await expect(page.locator('.auth-card input[type="email"]')).toBeVisible();

    await page.locator('.auth-card input[type="email"]').fill(fixtureEmail);
    await page.locator('.auth-card input[type="password"]').fill(fixturePassword);
    await page.getByRole("button", { name: "Sign In Securely" }).click();
    await expect(page.locator(".topbar h2")).toBeVisible({ timeout: 45000 });
    await expect(page.getByText("The workspace encountered a startup error.")).toHaveCount(0);

    expect(pageErrors, "uncaught startup exceptions").toEqual([]);
    expect(consoleErrors, "console errors during clean and signed-in startup").toEqual([]);
  });
}
