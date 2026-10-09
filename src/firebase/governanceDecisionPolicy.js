/**
 * Deterministic governance policy helpers.
 * The selected rule must be sourced from the organisation's applicable constitution,
 * approved policy or terms of reference; defaults are configuration defaults only.
 */
export const DEFAULT_GOVERNANCE_POLICY = Object.freeze({
  policyReference: "",
  policyVersion: "1",
  quorumBasis: "FIXED_COUNT",
  quorumValue: 1,
  votingDenominator: "BALLOTS_CAST",
  decisionThreshold: "SIMPLE_MAJORITY",
  customThresholdNumerator: 2,
  customThresholdDenominator: 3,
  abstentionsIncludedInBallotsCast: true,
  requireQuorumAtVoteOpen: true,
  requireQuorumAtVoteClose: true,
  requireAttendanceToVote: true
});

const QUORUM_BASES = new Set(["FIXED_COUNT", "PERCENT_ELIGIBLE"]);
const DENOMINATORS = new Set(["BALLOTS_CAST", "ELIGIBLE_PRESENT", "TOTAL_ELIGIBLE"]);
const THRESHOLDS = new Set(["SIMPLE_MAJORITY", "ONE_THIRD", "TWO_THIRDS", "CUSTOM"]);

export function normalizeGovernancePolicy(input = {}) {
  const p = { ...DEFAULT_GOVERNANCE_POLICY, ...(input || {}) };
  p.quorumBasis = QUORUM_BASES.has(p.quorumBasis) ? p.quorumBasis : DEFAULT_GOVERNANCE_POLICY.quorumBasis;
  p.votingDenominator = DENOMINATORS.has(p.votingDenominator) ? p.votingDenominator : DEFAULT_GOVERNANCE_POLICY.votingDenominator;
  p.decisionThreshold = THRESHOLDS.has(p.decisionThreshold) ? p.decisionThreshold : DEFAULT_GOVERNANCE_POLICY.decisionThreshold;
  p.quorumValue = Number(p.quorumValue);
  p.customThresholdNumerator = Number(p.customThresholdNumerator);
  p.customThresholdDenominator = Number(p.customThresholdDenominator);
  if (!Number.isFinite(p.quorumValue) || p.quorumValue < 1) throw new Error("Quorum requirement must be at least one person or one percent.");
  if (p.quorumBasis === "PERCENT_ELIGIBLE" && p.quorumValue > 100) throw new Error("Percentage quorum cannot exceed 100%.");
  if (p.decisionThreshold === "CUSTOM" &&
      (!Number.isInteger(p.customThresholdNumerator) || !Number.isInteger(p.customThresholdDenominator) ||
       p.customThresholdNumerator < 1 || p.customThresholdDenominator < 2 ||
       p.customThresholdNumerator >= p.customThresholdDenominator)) {
    throw new Error("A custom decision threshold requires a valid fraction, such as 2/3.");
  }
  p.policyReference = String(p.policyReference || "").trim();
  p.policyVersion = String(p.policyVersion || "1").trim() || "1";
  return p;
}

export function calculateQuorum({ policy: rawPolicy, eligibleCount = 0, presentCount = 0 } = {}) {
  const policy = normalizeGovernancePolicy(rawPolicy);
  const eligible = Math.max(0, Number(eligibleCount) || 0);
  const present = Math.max(0, Number(presentCount) || 0);
  const required = policy.quorumBasis === "PERCENT_ELIGIBLE"
    ? Math.ceil(eligible * policy.quorumValue / 100)
    : Math.ceil(policy.quorumValue);
  return { eligibleCount: eligible, presentCount: present, requiredCount: required, quorumMet: eligible > 0 && present >= required, policyVersion: policy.policyVersion };
}

export function calculateDecisionResult({ policy: rawPolicy, forVotes = 0, againstVotes = 0, abstainVotes = 0, eligiblePresentCount = 0, totalEligibleCount = 0, quorumMet = true } = {}) {
  const policy = normalizeGovernancePolicy(rawPolicy);
  const f = Math.max(0, Number(forVotes) || 0);
  const a = Math.max(0, Number(againstVotes) || 0);
  const s = Math.max(0, Number(abstainVotes) || 0);
  const ballotsCast = f + a + (policy.abstentionsIncludedInBallotsCast ? s : 0);
  const denominator = policy.votingDenominator === "ELIGIBLE_PRESENT" ? Math.max(0, Number(eligiblePresentCount) || 0)
    : policy.votingDenominator === "TOTAL_ELIGIBLE" ? Math.max(0, Number(totalEligibleCount) || 0)
    : ballotsCast;
  const ratio = policy.decisionThreshold === "ONE_THIRD" ? [1, 3]
    : policy.decisionThreshold === "TWO_THIRDS" ? [2, 3]
    : policy.decisionThreshold === "CUSTOM" ? [policy.customThresholdNumerator, policy.customThresholdDenominator]
    : [1, 2];
  const threshold = ratio[0] / ratio[1];
  const passesThreshold = policy.decisionThreshold === "SIMPLE_MAJORITY" ? denominator > 0 && f / denominator > threshold
    : denominator > 0 && f / denominator >= threshold;
  const validQuorum = !policy.requireQuorumAtVoteClose || quorumMet;
  const result = !validQuorum || denominator === 0 ? "Pending" : passesThreshold ? "Passed" : "Rejected";
  return { result, forVotes: f, againstVotes: a, abstainVotes: s, ballotsCast, denominator, thresholdNumerator: ratio[0], thresholdDenominator: ratio[1], threshold, quorumMet: Boolean(quorumMet), policyVersion: policy.policyVersion };
}
