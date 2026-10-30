import test from "node:test";
import assert from "node:assert/strict";
import { irpaProfile, IRPA_PILLARS } from "../src/grantPipeline/irpaProfile.js";
import { checkEligibility } from "../src/grantPipeline/eligibility.js";
import { scoreFit } from "../src/grantPipeline/fitScore.js";
import { filterValidCalls } from "../src/grantPipeline/validity.js";
import { evidenceBank, substantiateClaims } from "../src/grantPipeline/evidenceBank.js";

const profile = { ...irpaProfile, yearsOfOperation: 5,
  budgetCapacity: { minimum: 1000, maximum: 100000, currency: "USD" },
  availableDocuments: ["registration"], pillars: IRPA_PILLARS.map(p => ({ ...p })) };
const eligibleCall = { eligibleCountries: ["Tanzania"], applicantTypes: ["NGO"],
  requiredApplicantTypes: ["NGO"], requiredDocuments: ["registration"] };

test("eligible call passes supplied eligibility criteria", () => assert.equal(checkEligibility(eligibleCall, profile).status, "ELIGIBLE"));
test("unknown history and capacity produce CONDITIONAL and missing reasons", () => {
  const result = checkEligibility({ ...eligibleCall, minimumYearsOperation: 3, minimumBudget: 5000 }, irpaProfile);
  assert.equal(result.status, "CONDITIONAL");
  assert.ok(result.missing.includes("IRPA years of operation"));
  assert.ok(result.missing.includes("IRPA budget capacity"));
});
test("explicit Tanzania exclusion is NOT_ELIGIBLE", () => assert.equal(checkEligibility({ ...eligibleCall, excludedCountries: ["Tanzania"] }, profile).status, "NOT_ELIGIBLE"));
test("expired calls are marked closed", () => {
  const result = filterValidCalls([{ id: "old", status: "open", deadline: "2026-10-01" }], { now: "2026-10-30T00:00:00Z" });
  assert.equal(result.closed[0].status, "CLOSED"); assert.equal(result.calls.length, 0);
});
test("duplicate calls are reported and only first is retained", () => {
  const result = filterValidCalls([{ id: "a", status: "open", url: "https://donor.test/call" }, { id: "b", status: "open", url: "https://donor.test/call" }], { now: "2026-10-30" });
  assert.equal(result.calls.length, 1); assert.equal(result.duplicates.length, 1);
});
test("only open/upcoming future calls are retained", () => {
  const result = filterValidCalls([{ id: "1", status: "open", deadline: "2026-12-01" }, { id: "2", status: "draft" }], { now: "2026-10-30" });
  assert.deepEqual(result.calls.map(c => c.id), ["1"]);
});
for (const pillar of IRPA_PILLARS) test(`fit score covers ${pillar.name}`, () => {
  const score = scoreFit({ primaryPillar: pillar.id, pillars: [pillar.id], eligibleCountries: ["Tanzania"], deadline: "2026-12-31" },
    { ...profile, pillars: [pillar] }, { now: "2026-10-30" });
  assert.equal(score.breakdown.pillarMatch.primaryMatch, true);
  assert.ok(score.score >= 0 && score.score <= 100);
  assert.equal(Object.values(score.breakdown).reduce((sum, item) => sum + item.max, 0), 100);
});
test("claims without exact verified bank support are flagged", () => {
  const [supported, unsupported] = substantiateClaims([
    { claim: evidenceBank[0].claim, evidenceIds: ["irpa-name"] },
    { claim: "IRPA has secured multiple international grants.", evidenceIds: [] }
  ]);
  assert.equal(supported.supported, true);
  assert.equal(unsupported.text, "[EVIDENCE NEEDED] IRPA has secured multiple international grants.");
});
