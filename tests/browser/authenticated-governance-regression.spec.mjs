import { test, expect } from "@playwright/test";

const fixtureEmail = "irpa-browser-fixture-admin@example.test";
const fixturePassword = "FixtureOnly-Password-2026!";

async function navigateModule(page, viewportName, module) {
  if (viewportName === "mobile") {
    if (module === "Finance Portfolio" || module === "Meeting Room" || module === "Documents" || module === "Voting") {
      const dialog = page.getByRole("dialog", { name: "Mobile navigation" });
      const sheetTitle = dialog.locator(".mobile-nav-sheet-header strong");
      const isPortalsSheet = await dialog.isVisible() && await sheetTitle.textContent() === "Portals";
      if (!isPortalsSheet) {
        await page.locator(".mobile-global-nav").getByRole("button", { name: "Portals" }).click();
      }
      await expect(sheetTitle).toHaveText("Portals");
      if (module === "Finance Portfolio") {
        await dialog.getByRole("button", { name: /Finance Portal/ }).click();
      } else if (module === "Documents") {
        await dialog.getByRole("button", { name: /Documents Portal/ }).click();
      } else if (module === "Voting") {
        await dialog.getByRole("button", { name: /Meeting Portal/ }).click();
        await dialog.getByRole("button", { name: /SUB-PORTAL.*Voting Portal/ }).click();
      } else {
        await dialog.getByRole("button", { name: /Meeting Portal/ }).click();
        await dialog.getByRole("button", { name: /SUB-PORTAL.*Meeting Room Portal/ }).click();
      }
    } else {
      await page.locator(".mobile-global-nav").getByRole("button", { name: "Menu" }).click();
      const dialog = page.getByRole("dialog", { name: "Mobile navigation" });
      await expect(dialog.locator(".mobile-nav-sheet-header strong")).toHaveText("Navigation");
      const label = module === "Grant Intelligence & Funding Opportunities" ? /Grant Intelligence.*Funding Opportunities/ : /Voting Portal/;
      await dialog.getByRole("button", { name: label }).click();
    }
  } else {
    const sidebar = page.locator(".sidebar");
    if (module === "Meeting Room" || module === "Voting") {
      // Child portal buttons are rendered after opening their parent in the sidebar.
      await sidebar.getByRole("button", { name: /Meeting Portal/ }).click();
      const childLabel = module === "Meeting Room" ? /SUB-PORTAL.*Meeting Room Portal/ : /SUB-PORTAL.*Voting Portal/;
      await sidebar.getByRole("button", { name: childLabel }).click();
    } else {
      const label = module === "Finance Portfolio" ? /Finance Portal|Finance Portfolio/ :
        module === "Documents" ? /Documents Portal|Documents/ :
        module === "Voting" ? /Voting Portal|Voting/ :
        /Grant Intelligence.*Funding Opportunities/;
      await sidebar.getByRole("button", { name: label }).first().click();
    }
  }
  if (module === "Documents") {
    const entryGate = page.locator("[data-irpa-field-gate]");
    await expect(entryGate).toBeVisible({ timeout: 15000 });
    await entryGate.getByRole("radio", { name: /Documents, correspondence and files/ }).check();
    await entryGate.getByRole("radio", { name: /Trial data/ }).check();
    await entryGate.getByRole("button", { name: "Confirm environment and continue" }).click();
    await expect(entryGate).toHaveCount(0);
  }
}

async function assertPortalAndNoOverflow(page, expectedText, width) {
  await expect(page.locator(".topbar h2")).toContainText(expectedText, { timeout: 30000 });
  const workspace = page.locator("main.content-area");
  await expect(workspace).toBeVisible();
  await expect.poll(
    () => workspace.evaluate(el => Math.abs(el.getBoundingClientRect().top)),
    { message: "destination workspace should scroll into the visible workspace area rather than leave the user at the global header", timeout: 10000 }
  ).toBeLessThanOrEqual(40);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth
  }));
  expect(dimensions.document, "unexpected horizontal page overflow").toBeLessThanOrEqual(dimensions.viewport + 1);
}

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 }
]) {
  test(`authenticated fundraising and governance portal regression at ${viewport.name} size`, async ({ page }) => {
    page.setDefaultTimeout(10000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    const externalRequests = [];
    const successfulExternalRequests = [];
    const uncaughtErrors = [];
    page.on("pageerror", error => uncaughtErrors.push(error.message));
    page.on("requestfinished", request => {
      const url = new URL(request.url());
      if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") successfulExternalRequests.push(url.href);
    });
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
      externalRequests.push(url.href);
      return route.abort();
    });

    await page.goto("/?adminModule=Grant%20Intelligence%20%26%20Funding%20Opportunities");
    await page.locator('.auth-card input[type="email"]').fill(fixtureEmail);
    await page.locator('.auth-card input[type="password"]').fill(fixturePassword);
    await page.getByRole("button", { name: "Sign In Securely" }).click();
    // A valid emulator administrator should enter the requested portal directly;
    // this workflow performs no data-entry writes except confirming Trial for Documents.
    await expect(page.locator(".topbar h2")).toContainText(/Grant Intelligence.*Funding Opportunities/, { timeout: 45000 });

    await assertPortalAndNoOverflow(page, /Grant Intelligence.*Funding Opportunities/, viewport.width);
    await expect(page.getByRole("heading", { name: "Corporate, climate and partnership sources" })).toBeVisible();
    const registryToggle = page.getByRole("button", { name: /Browse source registry/ });
    await expect(registryToggle).toHaveAttribute("aria-expanded", "false");
    await registryToggle.click();
    await expect(page.getByText(/23 of 23 source routes shown/)).toBeVisible();

    for (const [module, heading] of [
      ["Finance Portfolio", /Finance/],
      ["Meeting Room", /Meeting Room/],
      ["Documents", /Documents/],
      ["Voting", /Voting/],
      ["Grant Intelligence & Funding Opportunities", /Grant Intelligence.*Funding Opportunities/]
    ]) {
      await navigateModule(page, viewport.name, module);
      await assertPortalAndNoOverflow(page, heading, viewport.width);
    }

    expect(uncaughtErrors, "uncaught JavaScript errors during portal navigation").toEqual([]);
    expect(successfulExternalRequests, "no external or production request may complete in the isolated fixture").toEqual([]);
    test.info().annotations.push({ type: "network-isolation", description: `Blocked ${externalRequests.length} attempted external request(s); none completed.` });
  });
}
