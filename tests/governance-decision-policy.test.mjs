import test from "node:test";
import assert from "node:assert/strict";
import { calculateDecisionResult, calculateQuorum, normalizeGovernancePolicy } from "../src/firebase/governanceDecisionPolicy.js";

test("fixed-count quorum is evaluated against attendance", () => {
  const q = calculateQuorum({ policy: { quorumBasis: "FIXED_COUNT", quorumValue: 5 }, eligibleCount: 9, presentCount: 4 });
  assert.equal(q.requiredCount, 5);
  assert.equal(q.quorumMet, false);
});

test("percentage quorum rounds required people upward", () => {
  const q = calculateQuorum({ policy: { quorumBasis: "PERCENT_ELIGIBLE", quorumValue: 50 }, eligibleCount: 9, presentCount: 5 });
  assert.equal(q.requiredCount, 5);
  assert.equal(q.quorumMet, true);
});

test("two-thirds threshold passes exactly at two thirds when quorum is met", () => {
  const r = calculateDecisionResult({ policy: { decisionThreshold: "TWO_THIRDS", votingDenominator: "BALLOTS_CAST" }, forVotes: 4, againstVotes: 2, quorumMet: true });
  assert.equal(r.result, "Passed");
});

test("one-third threshold uses configured denominator", () => {
  const r = calculateDecisionResult({ policy: { decisionThreshold: "ONE_THIRD", votingDenominator: "TOTAL_ELIGIBLE" }, forVotes: 4, totalEligibleCount: 12, quorumMet: true });
  assert.equal(r.result, "Passed");
});

test("simple majority is strictly greater than half", () => {
  const r = calculateDecisionResult({ policy: { decisionThreshold: "SIMPLE_MAJORITY" }, forVotes: 2, againstVotes: 2, quorumMet: true });
  assert.equal(r.result, "Rejected");
});

test("decision is pending when configured closing quorum is not met", () => {
  const r = calculateDecisionResult({ policy: { decisionThreshold: "ONE_THIRD", requireQuorumAtVoteClose: true }, forVotes: 9, againstVotes: 0, quorumMet: false });
  assert.equal(r.result, "Pending");
});

test("invalid custom fractions are rejected", () => {
  assert.throws(() => normalizeGovernancePolicy({ decisionThreshold: "CUSTOM", customThresholdNumerator: 3, customThresholdDenominator: 3 }), /valid fraction/);
});
