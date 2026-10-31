import {expect} from "@playwright/test";

export const grantAnalyseFixtureCredentials = Object.freeze({
  email: "irpa-browser-fixture-admin@example.test",
  password: "FixtureOnly-Password-2026!"
});

/**
 * Sign in to the emulator administrator created by
 * scripts/seed-authenticated-browser-fixture.cjs.
 * That existing seeder also creates the three grantOpportunities fixture
 * documents used by the Grant Intelligence portal.
 */
export async function signInToGrantIntelligenceFixture(page) {
  await page.goto("/?adminModule=Grant%20Intelligence%20%26%20Funding%20Opportunities");
  await page.locator('.auth-card input[type="email"]').fill(grantAnalyseFixtureCredentials.email);
  await page.locator('.auth-card input[type="password"]').fill(grantAnalyseFixtureCredentials.password);
  await page.getByRole("button", {name: "Sign In Securely"}).click();
  await expect(page.locator(".topbar h2")).toContainText(
    /Grant Intelligence.*Funding Opportunities/,
    {timeout: 45000}
  );
}
