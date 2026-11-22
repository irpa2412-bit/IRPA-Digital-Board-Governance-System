const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/meeting-real-record-protection-canary.yml"), "utf8");
const guard = fs.readFileSync(path.join(__dirname, "../scripts/canary-comment-authorized.cjs"), "utf8");
const canary = fs.readFileSync(path.join(__dirname, "../scripts/live-meeting-real-canary.cjs"), "utf8");
const { isAuthorizedComment, isAuthorizedManualInput } = require("../scripts/canary-comment-authorized.cjs");

function ownerComment() { return { action: "created", issue: { number: 876 }, comment: { body: "RUN CANARY", user: { id: 319164319, login: "irpa2412-bit" } } }; }

test("accepts exact owner comment on dedicated issue", () => assert.equal(isAuthorizedComment(ownerComment()), true));
test("rejects another author", () => { const e = ownerComment(); e.comment.user = { id: 42, login: "other-user" }; assert.equal(isAuthorizedComment(e), false); });
test("rejects a different body", () => { const e = ownerComment(); e.comment.body = "RUN CANARY "; assert.equal(isAuthorizedComment(e), false); });
test("rejects a different issue", () => { const e = ownerComment(); e.issue.number = 875; assert.equal(isAuthorizedComment(e), false); });
test("rejects edited comments", () => { const e = ownerComment(); e.action = "edited"; assert.equal(isAuthorizedComment(e), false); });
test("rejects pull-request conversation comments", () => { const e = ownerComment(); e.issue.pull_request = { url: "not-an-issue" }; assert.equal(isAuthorizedComment(e), false); });
test("manual input must match exact text", () => { assert.equal(isAuthorizedManualInput("RUN CANARY"), true); assert.equal(isAuthorizedManualInput("RUN CANARY "), false); });
test("workflow listens only to newly created issue comments", () => {
  assert.match(workflow, /issue_comment:\s*\n\s*types:\s*\[created\]/);
  assert.doesNotMatch(workflow, /issue_comment:[\s\S]{0,80}edited/);
});
test("workflow pins the dedicated issue and both owner identity fields", () => {
  assert.match(workflow, /github\.event\.issue\.number == 876/);
  assert.match(workflow, /github\.event\.comment\.user\.id == 319164319/);
  assert.match(workflow, /github\.event\.comment\.user\.login == 'irpa2412-bit'/);
});
test("comment body is checked in a file-based guard, never interpolated into a shell command", () => {
  assert.match(guard, /event\.comment\.body === EXACT_BODY/);
  assert.doesNotMatch(workflow, /github\.event\.comment\.body/);
  assert.doesNotMatch(workflow, /run:.*github\.event\.comment/);
});
test("automatic read-only triggers remain separate from issue_comment", () => {
  const readOnly = workflow.split("  live-read-only:")[1].split("  canary:")[0];
  assert.match(readOnly, /github\.event_name == 'schedule'/);
  assert.match(readOnly, /github\.event_name == 'workflow_run'/);
  assert.doesNotMatch(readOnly, /issue_comment/);
});

test("canary fixture stores no administrator UID or email and does not capture a user-attributed record", () => {
  assert.doesNotMatch(canary, /initiatorUid:\s*admin\.uid|meetingHostUid:\s*admin\.uid|createdByUid:\s*admin\.uid|capturedByUid|capturedByEmail/);
  assert.doesNotMatch(canary, /\/api\/meeting-records\/capture/);
  assert.match(canary, /system-canary-record-/);
});
test("canary reuses an existing labelled meeting and linked record", () => {
  assert.match(canary, /where\("systemTestLabel", "==", LABEL\)/);
  assert.match(canary, /results\.reusedExistingMeeting = true/);
  assert.match(canary, /results\.reusedExistingRecord = true/);
  assert.match(canary, /results\.finalMeetingExists === true/);
  assert.match(canary, /results\.finalRecordExists === true/);
});
