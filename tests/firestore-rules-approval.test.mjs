import test from "node:test";
import assert from "node:assert/strict";
import { evaluateApproval, evaluateLabelEventApproval } from "../scripts/firestore-rules-approval.mjs";

const base = {
  changedFiles: ["src/example.js", "firestore.rules"],
  labels: ["firestore-rules-approved"],
  labelEvents: [{ id: 22, event: "labeled", label: { name: "firestore-rules-approved" }, actor: { login: "irpa2412-bit" }, created_at: "2026-11-10T18:00:00Z" }],
  timeline: [{ event: "committed", sha: "abc123" }, { id: 22, event: "labeled" }],
  rulesCommitIds: ["abc123"],
  allowedActors: ["irpa2412-bit"]
};


const eventBase = {
  action: "labeled",
  actor: "irpa2412-bit",
  labelName: "firestore-rules-approved",
  labels: ["firestore-rules-approved"],
  changedFiles: ["src/example.js", "firestore.rules"],
  rulesCommitIds: ["abc123"],
  allowedActors: ["irpa2412-bit"],
  headSha: "a".repeat(40),
  checkoutSha: "a".repeat(40)
};

test("owner label event approves the exact current PR head", () => {
  assert.equal(evaluateLabelEventApproval(eventBase).pass, true);
});

test("synchronize after approval requires the owner to re-apply the label", () => {
  const result = evaluateLabelEventApproval({ ...eventBase, action: "synchronize" });
  assert.equal(result.pass, false);
  assert.match(result.reason, /re-applied after the latest PR commit/);
});

test("non-allow-listed label actor cannot approve rules", () => {
  const result = evaluateLabelEventApproval({ ...eventBase, actor: "automation-bot" });
  assert.equal(result.pass, false);
  assert.match(result.reason, /unauthorized actor/);
});

test("approval event must match the exact checked-out PR head", () => {
  const result = evaluateLabelEventApproval({ ...eventBase, checkoutSha: "b".repeat(40) });
  assert.equal(result.pass, false);
  assert.match(result.reason, /exact checked-out PR head/);
});

test("missing approval label fails closed for changed rules", () => {
  const result = evaluateLabelEventApproval({ ...eventBase, labels: [] });
  assert.equal(result.pass, false);
  assert.match(result.reason, /label is absent/);
});

test("unchanged firestore.rules passes without requiring a label", () => {
  const result = evaluateApproval({ ...base, changedFiles: ["src/example.js"], labels: [], labelEvents: [], timeline: [], rulesCommitIds: [] });
  assert.equal(result.pass, true);
});

test("changed firestore.rules without label fails", () => {
  const result = evaluateApproval({ ...base, labels: [], labelEvents: [] });
  assert.equal(result.pass, false);
  assert.match(result.reason, /label is absent/);
});

test("owner-applied label after latest rules commit passes", () => {
  assert.equal(evaluateApproval(base).pass, true);
});

test("non-allow-listed label actor fails", () => {
  const result = evaluateApproval({ ...base, labelEvents: [{ ...base.labelEvents[0], actor: { login: "automation-bot" } }] });
  assert.equal(result.pass, false);
  assert.match(result.reason, /unauthorized actor/);
});

test("new rules commit after label makes approval stale", () => {
  const result = evaluateApproval({ ...base, timeline: [{ id: 22, event: "labeled" }, { event: "committed", sha: "def456" }], rulesCommitIds: ["def456"] });
  assert.equal(result.pass, false);
  assert.match(result.reason, /approval is stale; re-apply the label after reviewing the latest diff/);
});

test("API error fails closed", () => {
  const result = evaluateApproval({ apiError: "HTTP 503" });
  assert.equal(result.pass, false);
  assert.match(result.reason, /failing closed/);
});
