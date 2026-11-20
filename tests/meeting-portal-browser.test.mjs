import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = "http://127.0.0.1:4179/tests/fixtures/meeting-portal-fixture.html";
const widths = [360, 412, 768, 1280];
const storeKey = "irpa-meeting-fixture-v1";
const createdTitle = "TEST — Full Meeting Portal workflow";

const browser = await chromium.launch({ headless: true });
let failures = 0;
try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 960 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    try {
      const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      assert.equal(response?.status(), 200, "isolated fixture must return HTTP 200");
      await page.getByRole("heading", { name: "Meeting Centre" }).waitFor();
      await page.getByText(/TEST ENVIRONMENT — isolated browser fixture/).waitFor();
      await page.getByRole("button", { name: "Refresh Meeting Register" }).click();
      await page.getByRole("button", { name: "+ Register Meeting" }).click();

      const picker = page.getByRole("group", { name: "Select Board Members for this meeting" });
      await picker.getByText("TEST Active Board Member", { exact: true }).waitFor();
      assert.equal(await picker.getByText("TEST Inactive Board Member", { exact: true }).count(), 0,
        "inactive Board Members must not be offered");
      assert.equal(await picker.getByText("TEST Ordinary Member", { exact: true }).count(), 0,
        "ordinary members must not be offered as Board Members");

      await page.locator('input[name="title"]').fill(createdTitle);
      await page.locator('input[name="date"]').fill("2027-02-18");
      await page.locator('input[name="startTime"]').fill("10:00");
      await page.locator('input[name="endTime"]').fill("11:00");
      await page.locator('select[name="meetingPlatform"]').selectOption({ label: "Physical Venue" });
      await page.locator('input[name="venue"]').fill("TEST Longido Meeting Room");
      await page.locator('input[name="chairperson"]').fill("TEST Fixture Chairperson");
      await page.locator('textarea[name="agenda"]').fill("1. Confirm the agenda\n2. Review the work plan");
      await picker.locator("label").filter({ hasText: "TEST Active Board Member" }).locator('input[type="checkbox"]').check();
      await page.getByRole("button", { name: "Schedule Meeting" }).click();
      await page.getByText(/has been saved in the Meeting Particulars & Platforms Register/).waitFor();

      const persisted = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storeKey);
      const created = persisted.meetings.find(meeting => meeting.title === createdTitle);
      assert.ok(created, "TEST meeting should be saved in isolated localStorage");
      assert.deepEqual(created.memberUids, ["fixture-board-member-active"], "Board member document ID must persist");
      assert.deepEqual(created.participantUids, ["fixture-board-member-auth-uid"], "authenticated participant UID must persist");
      assert.deepEqual(created.participantEmails, ["board-member@example.test"], "participant email must persist");
      assert.equal(created.venue, "TEST Longido Meeting Room");
      assert.equal(created.startTime, "10:00");
      assert.equal(created.endTime, "11:00");
      assert.equal(created.date, "2027-02-18");

      await page.getByRole("button", { name: "Refresh Meeting Register" }).click();
      await page.getByText(createdTitle, { exact: true }).waitFor();
      let createdRow = page.locator("tr").filter({ hasText: createdTitle });
      await createdRow.getByRole("button", { name: "Open Workspace" }).click();
      await page.getByRole("button", { name: "Resolutions", exact: true }).first().click();
      await page.getByRole("heading", { name: "Resolutions" }).waitFor();
      await page.getByRole("button", { name: "+ New Resolution" }).click();
      await page.locator('select[name="meetingId"]').selectOption(created.id);
      await page.locator('textarea[name="matterPresented"]').fill("TEST matter: approval of the annual work plan.");
      await page.locator('textarea[name="proposedResolution"]').fill("TEST resolution: the Board approves the annual work plan subject to quarterly reporting.");
      await page.locator('input[name="mover"]').fill("TEST Board Member");
      await page.locator('input[name="seconder"]').fill("TEST Board Secretary");
      await page.locator('input[name="votingRequired"]').check();
      await page.getByRole("button", { name: "Create Resolution" }).click();
      await page.getByText("Resolution created and linked to its originating meeting.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Open Anonymous Voting" }).click();
      await page.getByText("Voting Open", { exact: true }).waitFor();
      const resolutionState = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storeKey);
      assert.equal(resolutionState.resolutions.length, 1, "resolution should be saved against the created meeting");
      assert.equal(resolutionState.resolutions[0].meetingId, created.id);
      assert.ok(resolutionState.resolutions[0].votingIssueId, "resolution voting should link to a vote issue");
      await page.getByRole("button", { name: "TEST: return to Meeting Centre" }).click();
      await page.getByRole("heading", { name: "Meeting Centre" }).waitFor();
      await page.getByRole("button", { name: "Refresh Meeting Register" }).click();
      createdRow = page.locator("tr").filter({ hasText: createdTitle });
      await createdRow.getByRole("button", { name: "Open Workspace" }).click();
      await page.getByRole("button", { name: "Meeting Room", exact: true }).first().click();
      await page.getByRole("heading", { name: "Meeting Room" }).waitFor();

      const meetingPicker = page.locator("select").first();
      await meetingPicker.selectOption(created.id);
      await page.getByText("TEST Guest — Position 1", { exact: true }).waitFor();
      await page.getByText("TEST Guest — Position 2", { exact: true }).waitFor();
      await page.getByText("TEST Guest — Position 3", { exact: true }).waitFor();
      await page.getByText("TEST Active Board Member", { exact: true }).waitFor();
      await page.getByText("4/4 Present", { exact: true }).waitFor();
      await page.waitForFunction(id => (window.__irpaFixtureActions || []).some(action => action.type === "quorum-assess" && action.meetingId === id), created.id);

      await page.getByRole("button", { name: /1\. Confirm the agenda/ }).click();
      await page.locator(".form-field").filter({ hasText: /^Motion$/ }).locator("textarea").fill("TEST motion: approve the work plan.");
      await page.locator(".form-field").filter({ hasText: /^Moved By$/ }).locator("input").fill("TEST Board Member");
      await page.locator(".form-field").filter({ hasText: /^Seconded By$/ }).locator("input").fill("TEST Secretary");
      await page.getByRole("button", { name: "Record Motion" }).click();
      await page.getByRole("button", { name: "Open Anonymous Vote" }).click();
      await page.locator(".form-field").filter({ hasText: /^Decision$/ }).locator("textarea").fill("TEST decision: approve the work plan subject to quarterly review.");
      await page.getByRole("button", { name: "Record Decision" }).click();
      await page.locator(".form-field").filter({ hasText: /^Action$/ }).locator("input").fill("TEST action: prepare quarterly implementation report.");
      await page.locator(".form-field").filter({ hasText: /^Responsible$/ }).locator("input").fill("TEST Programme Officer");
      await page.locator(".form-field").filter({ hasText: /^Deadline$/ }).locator('input[type="date"]').fill("2027-03-31");
      await page.getByRole("button", { name: "Record Action" }).click();

      const workflowRecords = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storeKey);
      assert.equal(workflowRecords.votes.length, 2, "resolution and agenda votes should be opened in the TEST store");
      assert.equal(workflowRecords.decisions.length, 1, "decision should be recorded in the TEST store");
      assert.equal(workflowRecords.resolutions.length, 1, "resolution should remain in the TEST store");
      assert.equal(workflowRecords.actions.length, 1, "action should be recorded in the TEST store");

      await page.getByRole("button", { name: "Dispatch Signing Requests" }).click();
      await page.getByText(/Signing requests dispatched through the Signature Portal email-link workflow/).waitFor();
      const signing = await page.evaluate(() => (window.__irpaFixtureActions || []).findLast(x => x.type === "attendance-signing-mock"));
      assert.ok(signing, "attendance signing must use the Signature Portal mock");
      assert.equal(signing.assignments.length, 4, "registered member and three guest positions must each receive a signer");
      assert.equal(signing.sameEmailCount, 3, "three guest positions sharing one email must remain separate signers");
      assert.equal(signing.emailSent, false, "the fixture must never send real email");
      const allMockActions = await page.evaluate(() => window.__irpaFixtureActions || []);
      assert.ok(allMockActions.every(action => action.emailSent === false), "no fixture action may send real email");
      assert.equal(new Set(signing.assignments.map(x => x.signerId)).size, 4, "each participant position must have its own signer ID");

      await page.getByPlaceholder(/The AI Assistant transcript appears here automatically/).fill("TEST minutes source: the Board reviewed and approved the work plan.");
      await page.getByRole("button", { name: "Save Transcript Now" }).click();
      await page.getByRole("button", { name: "Capture Draft Minutes" }).click();
      await page.getByText(`Draft Minutes — ${createdTitle}`, { exact: true }).waitFor();
      await page.getByRole("button", { name: "Sign a Document" }).click();
      const signingNavigation = await page.evaluate(() => (window.__irpaNavigationCalls || []).findLast(x => x.module === "Signature Platform") || null);
      assert.equal(signingNavigation?.context?.meetingId, created.id, "minutes signing navigation must retain meeting identity");
      assert.equal(signingNavigation?.context?.meetingReference, created.reference || created.title,
        "minutes signing navigation must retain the canonical meeting reference");

      await page.getByRole("button", { name: "TEST: switch to outsider" }).click();
      await page.getByRole("button", { name: "Record Action" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Record Action" }).isDisabled(), true,
        "outsider must not be able to record meeting actions");
      assert.equal(await page.getByRole("button", { name: "Dispatch Signing Requests" }).isDisabled(), true,
        "outsider must not be able to dispatch attendance signing");

      const layout = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        viewportMeta: document.querySelector('meta[name="viewport"]')?.content || ""
      }));
      assert.ok(layout.documentWidth <= layout.viewportWidth,
        `document overflows viewport at ${width}px: ${JSON.stringify(layout)}`);
      assert.ok(layout.viewportMeta.includes("width=device-width"), "responsive viewport meta must be present");
      assert.deepEqual(pageErrors, [], "no uncaught browser errors should occur");
      console.log(JSON.stringify({ test: "meeting-portal-full-workflow-fixture", width, result: "PASS", layout }));
    } catch (error) {
      failures++;
      console.error(JSON.stringify({ test: "meeting-portal-full-workflow-fixture", width, result: "FAIL", error: error.message, pageErrors }));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
if (failures) process.exit(1);
console.log("PASS: four viewport sizes covered meeting scheduling, participant identities, agenda, voting, decisions, actions, outsider denial, TEST attendance signing, and minutes-to-Signature-Portal navigation. No real records or emails were created.");
