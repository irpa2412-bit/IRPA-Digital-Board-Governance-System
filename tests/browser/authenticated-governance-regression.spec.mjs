import { test, expect } from "@playwright/test";

const fixtureEmail = "irpa-browser-fixture-admin@example.test";
const fixturePassword = "FixtureOnly-Password-2026!";

async function navigateModule(page, viewportName, module) {
  if (viewportName === "mobile") {
    if (["Meeting Room", "Voting", "Resolutions", "Decisions"].includes(module)) {
      // The mobile connected-workflow strip is intentionally hidden; verify each authorized destination directly.
      await page.goto("/?adminModule=" + encodeURIComponent(module));
      await expect(page.locator(".topbar h2")).toContainText(module, { timeout: 30000 });
    } else if (module === "Finance Portfolio" || module === "Documents") {
      const dialog = page.getByRole("dialog", { name: "Mobile navigation" });
      const sheetTitle = dialog.locator(".mobile-nav-sheet-header strong");
      const isPortalsSheet = await dialog.isVisible() && await sheetTitle.textContent() === "Portals";
      if (!isPortalsSheet) {
        await page.locator(".mobile-global-nav").getByRole("button", { name: "Portals" }).click();
      }
      await expect(sheetTitle).toHaveText("Portals");
      const label = module === "Finance Portfolio" ? /Finance Portal/ : /Documents Portal/;
      await dialog.getByRole("button", { name: label }).click();
    } else {
      await page.locator(".mobile-global-nav").getByRole("button", { name: "Menu" }).click();
      const dialog = page.getByRole("dialog", { name: "Mobile navigation" });
      await expect(dialog.locator(".mobile-nav-sheet-header strong")).toHaveText("Navigation");
      await dialog.getByRole("button", { name: /Grant Intelligence.*Funding Opportunities/ }).click();
    }
  } else {
    const sidebar = page.locator(".sidebar");
    if (["Meeting Room", "Voting", "Resolutions", "Decisions"].includes(module)) {
      // Child portal buttons are rendered after opening their parent in the sidebar.
      await sidebar.getByRole("button", { name: /Meeting Portal/ }).click();
      const childLabel = {
        "Meeting Room": /SUB-PORTAL.*Meeting Room Portal/,
        "Voting": /SUB-PORTAL.*Voting Portal/,
        "Resolutions": /SUB-PORTAL.*Resolutions Portal/,
        "Decisions": /SUB-PORTAL.*Decisions Portal/
      }[module];
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
    // The field gate is a one-time session confirmation; do not require it to reappear on return navigation.
    if (await entryGate.count()) {
      await expect(entryGate).toBeVisible({ timeout: 15000 });
      await entryGate.getByRole("radio", { name: /Documents, correspondence and files/ }).check();
      await entryGate.getByRole("radio", { name: /Trial data/ }).check();
      await entryGate.getByRole("button", { name: "Confirm environment and continue" }).click();
      await expect(entryGate).toHaveCount(0);
    }
  }
}

async function assertPortalAndNoOverflow(page, expectedText, width) {
  await expect(page.locator(".topbar h2")).toContainText(expectedText, { timeout: 30000 });
  const workspace = page.locator("[data-active-portal-content]:visible").first();
  await expect(workspace).toBeVisible();
  await expect(workspace, "navigation must focus the destination portal body, not the shared header").toBeFocused();
  await expect.poll(
    () => workspace.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const header = document.querySelector(".main-area > header.topbar");
      return rect.top - (header?.getBoundingClientRect().bottom || 0);
    }),
    { message: "destination portal body should be aligned directly below the shared header", timeout: 10000 }
  ).toBeGreaterThanOrEqual(-2);
  const destination = await workspace.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const header = document.querySelector(".main-area > header.topbar");
    return { top: rect.top, headerBottom: header?.getBoundingClientRect().bottom || 0, viewportHeight: window.innerHeight };
  });
  expect(destination.top, "destination content must be brought into the viewport rather than leaving the header as the focus target").toBeLessThan(destination.viewportHeight);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth
  }));
  expect(dimensions.document, "unexpected horizontal page overflow").toBeLessThanOrEqual(dimensions.viewport + 1);
  const controls = await page.locator(".module-interlink-bar button:visible").evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    return {
      label: (node.innerText || node.getAttribute("aria-label") || "").trim(),
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight
    };
  }));
  for (const control of controls) {
    expect(control.width, `zero-width workflow control: ${control.label}`).toBeGreaterThan(0);
    expect(control.left, `workflow control left edge outside viewport: ${control.label}`).toBeGreaterThanOrEqual(-1);
    expect(control.right, `workflow control right edge outside viewport: ${control.label}`).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(control.scrollWidth, `clipped horizontal label: ${control.label}`).toBeLessThanOrEqual(control.clientWidth + 1);
    expect(control.scrollHeight, `clipped vertical label: ${control.label}`).toBeLessThanOrEqual(control.clientHeight + 1);
  }
}

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
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
      ["Resolutions", /Resolutions/],
      ["Voting", /Voting/],
      ["Decisions", /Decisions/],
      ["Grant Intelligence & Funding Opportunities", /Grant Intelligence.*Funding Opportunities/]
    ]) {
      await navigateModule(page, viewport.name, module);
      await assertPortalAndNoOverflow(page, heading, viewport.width);
    }

    // Exercise signing-workflow links where the connected-workflow strip is available; no records are created or signed.
    if (viewport.name !== "mobile") {
      await navigateModule(page, viewport.name, "Documents");
      await page.locator(".module-interlink-bar").getByRole("button", { name: "Signing Workspace" }).click();
      await expect(page.locator(".module-interlink-bar .workflow-action-portal.active")).toContainText("Signing Workspace");
      await page.locator(".module-interlink-bar").getByRole("button", { name: "Post-Signature Work" }).click();
      await expect(page.locator(".module-interlink-bar .workflow-action-portal.active")).toContainText("Post-Signature Work");
    }

    expect(uncaughtErrors, "uncaught JavaScript errors during portal navigation").toEqual([]);
    expect(successfulExternalRequests, "no external or production request may complete in the isolated fixture").toEqual([]);
    test.info().annotations.push({ type: "network-isolation", description: `Blocked ${externalRequests.length} attempted external request(s); none completed.` });
  });
}


// Every route rendered by the application shell is inspected at three viewport sizes.
// This is a read-only UI regression: the fixture blocks external traffic and creates no records.
const APP_PORTALS = [
  "Dashboard",
  "IT Operations",
  "Board Members Registration",
  "Invitations",
  "Members & Personnel",
  "Meetings",
  "Meeting Room",
  "Participants",
  "Resolutions",
  "Voting",
  "Authorization & Approvals",
  "Documents",
  "Signature Platform",
  "Induction and Orientation",
  "Induction Applications",
  "Downloads",
  "Finance Portfolio",
  "Procurement",
  "External Auditor Portal",
  "Auditors & Special Invitees",
  "Settings",
  "Add Administrator",
  "Employee Payments",
  "Actions",
  "Decisions",
  "Reports",
  "Risk Register",
  "Audit Trail",
  "Grant Intelligence & Funding Opportunities",
  "Research, Statistics and Knowledge"
];

async function assertSharedReadability(page, module, width) {
  const title = page.locator(".topbar h2");
  await expect(title, `portal heading should render for ${module}`).toBeVisible({ timeout: 30000 });
  await expect(title).not.toHaveText("");
  const workspace = page.locator("[data-active-portal-content]:visible").first();
  await expect(workspace, `active portal content should render for ${module}`).toBeVisible({ timeout: 30000 });
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth
  }));
  expect(dimensions.document, `horizontal overflow in ${module} at ${width}px`).toBeLessThanOrEqual(dimensions.viewport + 1);

  if (module !== "Dashboard") {
    const workspaceBackground = await page.locator(".content-area:not(.dashboard-content-area)")
      .evaluate(el => getComputedStyle(el).backgroundColor);
    expect(workspaceBackground, `shared Procurement-inspired workspace should be applied to ${module}`)
      .toBe("rgb(248, 250, 249)");
  }

  const samples = await workspace.evaluate(root => {
    const candidates = [...root.querySelectorAll(
      '.page h1, .page h2, .page h3, .page label, .page table th, .page p, .page li, .page legend, .page button, .page table td, .page [role="heading"]'
    )];
    const visible = candidates.filter(el => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && (el.textContent || "").trim();
    }).slice(0, 12);
    const luminance = color => {
      const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (!m) return null;
      const channels = m.slice(1, 4).map(v => Number(v) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    return visible.map(el => {
      const fg = getComputedStyle(el).color;
      let node = el, backgrounds = [];
      while (node && node !== document.documentElement) {
        const style = getComputedStyle(node);
        const image = style.backgroundImage || "none";
        if (image !== "none" && image.includes("gradient")) {
          const stops = [...image.matchAll(/rgba?\(\s*\d+,\s*\d+,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/g)].map(match => match[0]);
          if (stops.length) { backgrounds = stops; break; }
        }
        const candidate = style.backgroundColor;
        if (candidate && !candidate.includes("rgba(0, 0, 0, 0)") && candidate !== "transparent") {
          backgrounds = [candidate];
          break;
        }
        node = node.parentElement;
      }
      const a = luminance(fg);
      const backgroundLuminances = backgrounds.map(luminance).filter(value => value !== null);
      const ratios = a === null ? [] : backgroundLuminances.map(b => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
      const ratio = ratios.length ? Math.min(...ratios) : null;
      const bg = backgrounds.join(" / ") || "unknown background";
      return { tag: el.tagName, text: (el.textContent || "").trim().slice(0, 50), fg, bg, ratio };
    });
  });
  expect(samples.length, `portal should render visible text for readability checks in ${module}`).toBeGreaterThan(0);
  for (const sample of samples) {
    if (sample.ratio !== null) {
      expect(sample.ratio, `low text contrast in ${module}: ${sample.tag} "${sample.text}" (${sample.fg} on ${sample.bg})`)
        .toBeGreaterThanOrEqual(4.5);
    }
  }
}

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 }
]) {
  test(`all registered portal workspaces retain readability at ${viewport.name} size`, async ({ page }) => {
    page.setDefaultTimeout(10000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const externalRequests = [];
    const completedExternalRequests = [];
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("requestfinished", request => {
      const url = new URL(request.url());
      if (!["localhost", "127.0.0.1"].includes(url.hostname)) completedExternalRequests.push(url.href);
    });
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (["localhost", "127.0.0.1"].includes(url.hostname)) return route.continue();
      externalRequests.push(url.href);
      return route.abort();
    });

    await page.goto("/?adminModule=" + encodeURIComponent("Grant Intelligence & Funding Opportunities"));
    await page.locator('.auth-card input[type="email"]').fill(fixtureEmail);
    await page.locator('.auth-card input[type="password"]').fill(fixturePassword);
    await page.getByRole("button", { name: "Sign In Securely" }).click();
    await expect(page.locator(".topbar h2")).toContainText(/Grant Intelligence.*Funding Opportunities/, { timeout: 45000 });

    for (const module of APP_PORTALS) {
      await page.goto("/?adminModule=" + encodeURIComponent(module));
      await expect(page.locator(".topbar h2")).toBeVisible({ timeout: 30000 });
      await expect(page.locator("[data-active-portal-content]:visible").first()).toBeVisible({ timeout: 30000 });
      await assertSharedReadability(page, module, viewport.width);
    }

    expect(completedExternalRequests, "isolated browser test must not complete external/production requests").toEqual([]);
    expect(pageErrors, "no uncaught runtime errors across the portal sweep").toEqual([]);
    test.info().annotations.push({
      type: "coverage",
      description: `Inspected ${APP_PORTALS.length} portal routes at ${viewport.width}px; blocked ${externalRequests.length} external requests.`
    });
  });
}
