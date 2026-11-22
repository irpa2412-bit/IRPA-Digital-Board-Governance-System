import { test, expect } from "@playwright/test";

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  test(`fundraising source registry renders and filters at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/tests/browser/fundraising-registry-harness.html");
    await expect(page.getByRole("heading", { name: "Corporate, climate and partnership sources" })).toBeVisible();

    const toggle = page.getByRole("button", { name: /Browse source registry/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(page.getByRole("button", { name: /Collapse source registry/ })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText(/23 of 23 source routes shown/)).toBeVisible();

    await page.getByRole("textbox", { name: "Search fundraising source registry" }).fill("climate");
    await expect(page.getByText(/source routes shown/)).toBeVisible();
    await expect(page.getByText(/no sources match/i)).toHaveCount(0);

    await page.getByRole("button", { name: "Research funding fit" }).first().click();
    const selectedName = await page.evaluate(() => window.__selectedResearchSource?.name);
    expect(selectedName).toBeTruthy();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${viewport.width}px`).toBe(false);
  });
}
