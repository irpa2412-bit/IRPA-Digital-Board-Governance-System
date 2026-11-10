import test from "node:test";
import assert from "node:assert/strict";
import { evaluateApproval } from "../scripts/firestore-rules-approval.mjs";

const base = {
  changedFiles: ["src/example.js", "firestore.rules"],
  labels: ["firestore-rules-approved"],
  labelEvents: [{ event: "labeled", label: { name: "firestore-rules-approved" }, actor: { login: "irpa2412-bit" }, created_at: "2026-11-10T18:00:00Z" }],
  rulesCommitEvents: [{ commit_id: "abc123", created_at: "2026-11-10T17:00:00Z" }],
  allowedActors: ["irpa2412-bit"]
};

test("unchanged firestore.rules passes without requiring a label", () => {
  const result = evaluateApproval({ ...base, changedFiles: ["src/example.js"], labels: [], labelEvents: [], rulesCommitEvents: [] });
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
  const result = evaluateApproval({ ...base, rulesCommitEvents: [{ commit_id: "def456", created_at: "2026-11-10T19:00:00Z" }] });
  assert.equal(result.pass, false);
  assert.match(result.reason, /approval is stale; re-apply the label after reviewing the latest diff/);
});

test("API error fails closed", () => {
  const result = evaluateApproval({ apiError: "HTTP 503" });
  assert.equal(result.pass, false);
  assert.match(result.reason, /failing closed/);
});
