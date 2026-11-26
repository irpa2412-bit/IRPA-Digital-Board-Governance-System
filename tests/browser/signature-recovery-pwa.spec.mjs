import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "allow" });

const fixtureEmail = "irpa-browser-fixture-admin@example.test";
const fixturePassword = "FixtureOnly-Password-2026!";

test("Signature Recovery refresh makes two fresh authenticated requests on a mobile PWA shell", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const gateway = "https://irpa-google-drive-gateway.irpa-governance.workers.dev";
  let queueRequests = [];
  let failNext = false;
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === gateway) {
      if (route.request().method() === "OPTIONS") {
        return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "authorization" } });
      }
      if (url.pathname === "/health") {
        return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type" }, body: JSON.stringify({ ok: true, version: "worker-fixture-v2", commit: "worker-fixture-v2" }) });
      }
      if (url.pathname === "/api/recovery/envelopes") {
        const headers = await route.request().allHeaders();
        queueRequests.push({ authorization: headers.authorization || "" });
        if (failNext) {
          failNext = false;
          return route.fulfill({ status: 403, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type", "x-request-id": "refresh-failure-fixture" }, body: JSON.stringify({ ok: false, code: "NOT_OWNER", error: "Not the envelope owner", requestId: "refresh-failure-fixture" }) });
        }
        return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type" }, body: JSON.stringify({ ok: true, total: 1, items: [{ envelopeId: "READONLY-FIXTURE-ENVELOPE", documentId: "READONLY-FIXTURE-DOCUMENT", title: "Read-only refresh fixture", status: "InProgress", stage: "PENDING" }] }) });
      }
    }
    if (["localhost", "127.0.0.1"].includes(url.hostname)) return route.continue();
    return route.abort();
  });

  await page.goto("/?adminModule=Signature%20Platform");
  await page.locator('.auth-card input[type="email"]').fill(fixtureEmail);
  await page.locator('.auth-card input[type="password"]').fill(fixturePassword);
  await page.getByRole("button", { name: "Sign In Securely" }).click();
  await expect(page.getByRole("heading", { name: /Signature Recovery Assessment/ })).toBeVisible({ timeout: 45000 });
  await expect(page.getByText("Read-only refresh fixture")).toBeVisible({ timeout: 20000 });
  const pwaState = await page.evaluate(async () => {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    if (!manifestLink) return { display: null, workerState: null };
    const manifestResponse = await fetch(manifestLink.href, { cache: "no-store" });
    if (!manifestResponse.ok) return { display: null, workerState: null };
    const manifest = await manifestResponse.json();
    const registration = await navigator.serviceWorker.ready;
    return { display: manifest.display || null, workerState: registration.active?.state || null };
  });
  expect(pwaState.display).toBe("standalone");
  expect(pwaState.workerState).toBe("activated");
  await expect(page.getByText("worker-fixture-v2")).toBeVisible();
  await expect(page.getByText(/Web build:/)).toBeVisible();

  queueRequests = [];
  const refresh = page.getByRole("button", { name: "Refresh recovery queue" });
  await refresh.click();
  await expect.poll(() => queueRequests.length).toBe(1);
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect.poll(() => queueRequests.length).toBe(2);
  expect(queueRequests.every(request => request.authorization.startsWith("Bearer "))).toBe(true);
  expect(queueRequests[0].authorization).not.toBe("");

  failNext = true;
  await refresh.click();
  await expect(page.getByRole("alert")).toContainText("NOT_OWNER");
  await expect(page.getByRole("alert")).toContainText("refresh-failure-fixture");
  await expect(page.getByText("Read-only refresh fixture")).toHaveCount(0);
  await expect(page.getByText(/Last refreshed at:/)).not.toContainText("Not yet refreshed");
});

test("PWA worker activates the deployed build and removes the previous shell cache", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const oldCache = "irpa-dbgs-shell-old-deploy-fixture";
    await caches.open(oldCache);
    const registration = await navigator.serviceWorker.register("/sw.js?v=new-deploy-fixture", { scope: "/", updateViaCache: "none" });
    await registration.update();
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const current = await navigator.serviceWorker.getRegistration("/");
      const cacheKeys = await caches.keys();
      if (
        current?.active?.scriptURL.includes("new-deploy-fixture") &&
        current.active.state === "activated" &&
        !cacheKeys.includes(oldCache)
      ) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const current = await navigator.serviceWorker.getRegistration("/");
    return {
      activeScript: current?.active?.scriptURL || "",
      oldCachePresent: (await caches.keys()).includes(oldCache),
      newCachePresent: (await caches.keys()).includes("irpa-dbgs-shell-20261126-refresh-pwa-1")
    };
  });
  expect(result.activeScript).toContain("new-deploy-fixture");
  expect(result.oldCachePresent).toBe(false);
  expect(result.newCachePresent).toBe(true);
});
