import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

test("archived social account record wraps safely at 1440px and 900px", async ({ page }) => {
  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(`
      <main class="social-media-accounts" style="width:100%;max-width:100%;padding:20px">
        <section style="width:100%;min-width:0">
          <h2>Registered accounts</h2>
          <div class="social-media-accounts__counts">
            <span>Active accounts: <strong>0</strong></span>
            <span>Archived accounts: <strong>1</strong></span>
          </div>
          <article class="social-media-accounts__record" style="border:1px solid #cbd5e1;border-radius:9px;padding:12px">
            <strong>Facebook: IRPA official Facebook Page</strong>
            <span>Archived</span>
            <p>https://example.invalid/${"very-long-unbroken-account-value-".repeat(12)}</p>
            <p>${"Long operational note without spaces ".repeat(18)}</p>
            <button type="button">Unarchive</button>
          </article>
        </section>
      </main>
    `);
    await page.addStyleTag({ path: resolve("src/styles/social-media-accounts.css") });
    await expect(page.getByText("Archived accounts:")).toBeVisible();
    await expect(page.getByText("Facebook: IRPA official Facebook Page")).toBeVisible();
    const metrics = await page.evaluate(() => {
      const card = document.querySelector(".social-media-accounts__record");
      const rect = card.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        cardLeft: rect.left,
        cardRight: rect.right,
        cardWidth: rect.width,
        bodyWidth: document.body.getBoundingClientRect().width
      };
    });
    expect(metrics.viewportWidth).toBe(width);
    expect(metrics.documentWidth).toBeLessThanOrEqual(width);
    expect(metrics.cardLeft).toBeGreaterThanOrEqual(0);
    expect(metrics.cardRight).toBeLessThanOrEqual(width + 1);
    expect(metrics.cardWidth).toBeGreaterThan(0);
  }
});
