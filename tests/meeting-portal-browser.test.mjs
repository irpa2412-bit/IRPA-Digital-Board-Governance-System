import assert from "node:assert/strict";
import { chromium } from "playwright";
const url = "http://127.0.0.1:4179/tests/fixtures/meeting-portal-fixture.html";
const widths = [360, 1440];
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
      const layout = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        const visible = [...document.querySelectorAll("body *")].filter(el => { const r=el.getBoundingClientRect(),s=getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=="hidden"&&s.display!=="none"&&(el.innerText||"").trim(); });
        const rgb = value => { const m=value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i); return m?[+m[1],+m[2],+m[3]]:null; };
        const luminance = color => { const v=color.map(x=>{x/=255;return x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4;});return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2]; };
        const failures=[];
        for(const el of visible){const text=(el.innerText||"").trim().replace(/\s+/g," ");if(!text||text.length>180)continue;const s=getComputedStyle(el),fg=rgb(s.color);let node=el,bg=null;while(node&&node!==document.documentElement){const ns=getComputedStyle(node),candidate=rgb(ns.backgroundColor);if(candidate&&ns.backgroundColor!=="rgba(0, 0, 0, 0)"){bg=candidate;break;}node=node.parentElement;}if(!bg)bg=[255,255,255];if(!fg)continue;const a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05),large=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700);if(ratio<(large?3:4.5))failures.push({text:text.slice(0,70),ratio:Number(ratio.toFixed(2))});}
        return {width,scrollWidth,horizontalOverflow:scrollWidth>width+1,contrastFailureCount:failures.length,contrastExamples:failures.slice(0,8)};
      });
      console.log("Meeting portal viewport audit " + width + "px: " + JSON.stringify(layout));
      assert.equal(layout.horizontalOverflow, false, "meeting portal must not horizontally scroll at " + width + "px");
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
      const createdRow = page.locator("tr").filter({ hasText: createdTitle });
      await createdRow.getByRole("button", { name: "Open Workspace" }).click();
      await page.getByRole("button", { name: "Prepare Document for Signature" }).waitFor();
      await page.getByRole("button", { name: "Prepare Document for Signature" }).click();
      const signatureNavigation = await page.evaluate(() => (window.__irpaNavigationCalls || []).at(-1) || null);
      assert.equal(signatureNavigation?.module, "Signature Platform", "meeting action must navigate to the Signature Portal");
      assert.equal(signatureNavigation?.context?.meetingId, created.id, "Signature Portal context must include the selected meeting ID");
      assert.equal(signatureNavigation?.context?.meetingReference, created.meetingReference, "Signature Portal context must include the canonical meeting reference");
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
