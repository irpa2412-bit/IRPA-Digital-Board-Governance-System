import { test, expect } from "@playwright/test";

const fixtureEmail = "irpa-browser-fixture-admin@example.test";
const fixturePassword = "FixtureOnly-Password-2026!";

test("production minified bundle completes authenticated Create Drive file with a mocked Gateway", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors = [];
  const gatewayCalls = [];
  page.on("pageerror", error => {
    const captured = { name: error.name, message: error.message, stack: error.stack || "" };
    pageErrors.push(captured);
    console.error("UPLOAD_PAGEERROR", JSON.stringify(captured));
  });

  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (["localhost", "127.0.0.1"].includes(url.hostname)) {
      return route.continue();
    }
    if (url.pathname === "/api/documents/next-reference") {
      gatewayCalls.push({ path: url.pathname, body: route.request().postDataJSON() });
      expect(route.request().headers()["authorization"]).toMatch(/^Bearer\s+/);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, reference: "IRPA-DIAG-2026-000001" })
      });
    }
    if (url.pathname === "/api/upload-controlled-document") {
      const body = route.request().postDataJSON();
      gatewayCalls.push({ path: url.pathname, body });
      expect(route.request().headers()["authorization"]).toMatch(/^Bearer\s+/);
      expect(body.base64).toBeTruthy();
      expect(body.fileName).toBe("irpa-upload-runtime-fixture.pdf");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          categoryArchive: {
            folderId: "fixture-category-folder",
            archiveUidLink: "https://drive.google.com/drive/folders/fixture-category-folder",
            archivePath: body.destinationKey,
            file: {
              fileId: "fixture-drive-file-id",
              name: body.fileName,
              webViewLink: "https://drive.google.com/file/d/fixture-drive-file-id/view"
            }
          },
          governanceArchive: {
            folderId: "fixture-governance-folder",
            archiveUidLink: "https://drive.google.com/drive/folders/fixture-governance-folder",
            archivePath: body.destinationKey,
            file: { fileId: "fixture-drive-file-id", name: body.fileName }
          }
        })
      });
    }
    if (url.pathname === "/api/upload-controlled-document/register") {
      const body = route.request().postDataJSON();
      gatewayCalls.push({ path: url.pathname, body });
      expect(route.request().headers()["authorization"]).toMatch(/^Bearer\s+/);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, documentId: body.documentId, recordOrigin: "TRIAL" })
      });
    }
    return route.abort();
  });

  await page.goto("/?adminModule=Authorization%20%26%20Approvals");
  await page.locator('.auth-card input[type="email"]').fill(fixtureEmail);
  await page.locator('.auth-card input[type="password"]').fill(fixturePassword);
  await page.getByRole("button", { name: "Sign In Securely" }).click();
  await expect(page.locator(".topbar h2")).toContainText("Authorization", { timeout: 45000 });
  await expect(page.getByText("CONTROLLED DOCUMENT UPLOAD")).toBeVisible({ timeout: 30000 });
  await page.getByPlaceholder("Enter document title").press("A");
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15000 });
  await page.getByRole("radio", { name: "Documents, correspondence and files" }).check();
  await page.getByRole("radio", { name: "Trial data — testing and demonstrations" }).check();
  await page.getByRole("button", { name: "Confirm environment and continue" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15000 });
  await page.getByPlaceholder("Enter document title").fill("Upload Runtime Browser Fixture");
  await page.getByLabel("Document Type").selectOption("Governance");
  await page.getByLabel("Select document file").setInputFiles({
    name: "irpa-upload-runtime-fixture.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\n")
  });
  await page.locator(".controlled-document-upload-panel").getByRole("button", { name: "Upload Document", exact: true }).click();

  await expect.poll(() => gatewayCalls.filter(call => call.path === "/api/upload-controlled-document").length,
    { timeout: 30000, message: "production bundle should reach the mocked Create Drive file Gateway route" }
  ).toBe(1);
  await expect(page.getByText(/Drive file ID: fixture-drive-file-id/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/PASS — Create Drive file/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Document uploaded successfully to Google Drive/)).toBeVisible({ timeout: 30000 });

  const referenceErrors = pageErrors.filter(error => error.name === "ReferenceError");
  expect(referenceErrors, "any ReferenceError in the minified production bundle must fail the browser regression").toEqual([]);
  expect(pageErrors, "capture and reject uncaught browser errors during the real upload transaction").toEqual([]);
  expect(gatewayCalls.map(call => call.path)).toEqual([
    "/api/documents/next-reference",
    "/api/upload-controlled-document",
    "/api/upload-controlled-document/register"
  ]);
});
