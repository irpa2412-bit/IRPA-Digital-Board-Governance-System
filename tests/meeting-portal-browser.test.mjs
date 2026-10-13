import assert from "node:assert/strict";
import { chromium } from "playwright";
const url = "http://127.0.0.1:4179/tests/fixtures/meeting-portal-fixture.html";
const widths = [390, 1366];
const storeKey = "irpa-meeting-fixture-v1";
const createdTitle = "Fixture Meeting Persistence Check";
const browser = await chromium.launch({ headless: true });
let failures = 0;
try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    try {
      const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      assert.equal(response?.status(), 200, "fixture must return HTTP 200");
      await page.getByRole("heading", { name: "Meeting Centre" }).waitFor();
      await page.getByRole("heading", { name: "Registered Meetings" }).waitFor();
      await page.getByText("Previously Scheduled Board Meeting", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Refresh Meeting Register" }).click();
      await page.getByText("Previously Scheduled Board Meeting", { exact: true }).waitFor();
      await page.getByRole("button", { name: "+ Register Meeting" }).click();
      const picker = page.getByRole("group", { name: "Select Board Members for this meeting" });
      await picker.getByText("Active Board Member Fixture", { exact: true }).waitFor();
      assert.equal(await picker.getByText("Inactive Board Member Fixture", { exact: true }).count(), 0,
        "inactive Board Members must not be offered");
      assert.equal(await picker.getByText("Ordinary Member Fixture", { exact: true }).count(), 0,
        "ordinary members must not be offered as Board Members");
      await page.locator('input[name="title"]').fill(createdTitle);
      await page.locator('input[name="date"]').fill("2027-02-18");
      await page.locator('input[name="startTime"]').fill("10:00");
      await page.locator('input[name="endTime"]').fill("11:00");
      await page.locator('input[name="chairperson"]').fill("Fixture Chairperson");
      await page.locator('textarea[name="agenda"]').fill("Test persistence of selected Board Member associations.");
      await picker.locator("label").filter({ hasText: "Active Board Member Fixture" }).locator('input[type="checkbox"]').check();
      await page.getByRole("button", { name: "Schedule Meeting" }).click();
      await page.getByText(/has been saved in the Meeting Particulars & Platforms Register/).waitFor();
      const persisted = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storeKey);
      const created = persisted.meetings.find(meeting => meeting.title === createdTitle);
      assert.ok(created, "new meeting should be persisted to the fixture store");
      assert.deepEqual(created.memberUids, ["fixture-board-member-active"], "member document ID must persist");
      assert.deepEqual(created.participantUids, ["fixture-board-member-auth-uid"], "authenticated participant UID must persist");
      assert.deepEqual(created.participantEmails, ["active-board-member@example.test"], "participant email must persist");
      assert.deepEqual(created.participantNames, ["Active Board Member Fixture"], "participant name must persist");
      assert.equal(created.participants[0].memberUid, "fixture-board-member-active");
      assert.equal(created.participants[0].uid, "fixture-board-member-auth-uid");
      await page.getByRole("button", { name: "Refresh Meeting Register" }).click();
      await page.getByText(createdTitle, { exact: true }).waitFor();
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Meeting Centre" }).waitFor();
      await page.getByText("Previously Scheduled Board Meeting", { exact: true }).waitFor();
      await page.getByText(createdTitle, { exact: true }).waitFor();
      const layout = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        viewportMeta: document.querySelector('meta[name="viewport"]')?.content || ""
      }));
      assert.ok(layout.documentWidth <= layout.viewportWidth, `document overflows viewport at ${width}px: ${JSON.stringify(layout)}`);
      assert.ok(layout.viewportMeta.includes("width=device-width"), "responsive viewport meta must be present");
      assert.deepEqual(pageErrors, [], "no uncaught browser errors should occur");
      console.log(JSON.stringify({ test: "meeting-register-board-member-fixture", width, result: "PASS", layout }));
    } catch (error) {
      failures++;
      console.error(JSON.stringify({ test: "meeting-register-board-member-fixture", width, result: "FAIL", error: error.message, pageErrors }));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
if (failures) process.exit(1);
console.log("PASS: isolated authenticated-identity fixture covered scheduled-meeting retrieval, active Board Member filtering, participant persistence, reload persistence, and mobile/desktop viewport containment.");
