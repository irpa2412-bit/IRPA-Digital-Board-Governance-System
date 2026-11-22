const test = require("node:test");
const assert = require("node:assert/strict");
const { isAuthorizedComment, isAuthorizedManualInput } = require("../scripts/canary-comment-authorized.cjs");

function ownerComment() { return { action: "created", issue: { number: 876 }, comment: { body: "RUN CANARY", user: { id: 319164319, login: "irpa2412-bit" } } }; }

test("accepts exact owner comment on dedicated issue", () => assert.equal(isAuthorizedComment(ownerComment()), true));
test("rejects another author", () => { const e = ownerComment(); e.comment.user = { id: 42, login: "other-user" }; assert.equal(isAuthorizedComment(e), false); });
test("rejects a different body", () => { const e = ownerComment(); e.comment.body = "RUN CANARY "; assert.equal(isAuthorizedComment(e), false); });
test("rejects a different issue", () => { const e = ownerComment(); e.issue.number = 875; assert.equal(isAuthorizedComment(e), false); });
test("rejects edited comments", () => { const e = ownerComment(); e.action = "edited"; assert.equal(isAuthorizedComment(e), false); });
test("rejects pull-request conversation comments", () => { const e = ownerComment(); e.issue.pull_request = { url: "not-an-issue" }; assert.equal(isAuthorizedComment(e), false); });
test("manual input must match exact text", () => { assert.equal(isAuthorizedManualInput("RUN CANARY"), true); assert.equal(isAuthorizedManualInput("RUN CANARY "), false); });