import { readFileSync } from "node:fs";

async function main() {
  const raw = readFileSync(0, "utf8");
  const crawlResult = JSON.parse(raw);
  const workerUrl = String(process.env.STAGING_WORKER_URL || "").replace(/\/+$/, "");
  const token = String(process.env.GRANT_CRAWLER_CONTROL_TOKEN || "");
  if (!/^https:\/\//i.test(workerUrl)) throw new Error("STAGING_WORKER_URL must be HTTPS.");
  if (token.length < 32) throw new Error("Crawler control token is missing or too short.");
  if (crawlResult.status !== "success") throw new Error("Crawler failed: " + String(crawlResult.error || crawlResult.status || "unknown error"));
  if (!Number(crawlResult.feedsConfigured)) throw new Error("No official feeds are configured.");

  const candidate = (crawlResult.topMatches || []).find(item => item.title && item.description && item.url);
  if (!candidate) {
    throw new Error("No geographically screened public grant opportunity is available for the required non-confidential AI smoke test; the assistant cannot be confirmed operational.");
  }

  const headers = {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  const publicResponse = await fetch(workerUrl + "/assistant/analyze", {
    method: "POST",
    headers,
    body: JSON.stringify({
      task: "eligibility",
      title: candidate.title,
      description: candidate.description,
      donorRequirements: candidate.description,
      url: candidate.url
    })
  });
  const publicBody = await publicResponse.json();
  if (!publicResponse.ok || publicBody.service !== "irpa-grant-application-assistant") {
    throw new Error("Public opportunity AI analysis failed with HTTP " + publicResponse.status + ".");
  }
  const assessment = publicBody.assessment || {};
  if (assessment.geographic_eligibility?.status !== "eligible") {
    throw new Error("Crawler surfaced a candidate whose AI geographic gate was not eligible: " + String(assessment.geographic_eligibility?.status || "missing"));
  }
  if (assessment.eligibility?.status === "eligible" &&
      ((assessment.eligibility.unknowns || []).length > 0 ||
       (assessment.donor_requirements || []).some(row => row.status !== "met"))) {
    throw new Error("AI assistant marked the public opportunity eligible despite unresolved mandatory requirements.");
  }

  const southAfricaFixture = {
    task: "eligibility",
    title: "Non-confidential staging fixture: South Africa-only NGO call",
    description: "Only organizations registered in South Africa may apply. Eligible applicants must be registered in South Africa as NGOs. Funding supports community climate resilience.",
    donorRequirements: "Only South African registered NGOs are eligible.",
    url: "https://www.gov.uk/international-development-funding"
  };
  const excludedResponse = await fetch(workerUrl + "/assistant/analyze", {
    method: "POST",
    headers,
    body: JSON.stringify(southAfricaFixture)
  });
  const excludedBody = await excludedResponse.json();
  if (!excludedResponse.ok ||
      excludedBody.assessment?.geographic_eligibility?.status !== "ineligible" ||
      excludedBody.assessment?.eligibility?.status !== "ineligible") {
    throw new Error("The assistant failed to reject the South Africa-only staging fixture.");
  }

  const blockedDraftResponse = await fetch(workerUrl + "/assistant/analyze", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...southAfricaFixture, task: "concept_note" })
  });
  if (blockedDraftResponse.status !== 422) {
    throw new Error("Concept-note drafting was not blocked for the South Africa-only fixture.");
  }

  console.log(JSON.stringify({
    crawlerStatus: crawlResult.status,
    feedsConfigured: crawlResult.feedsConfigured,
    itemsSeen: crawlResult.itemsSeen,
    recordsChanged: crawlResult.recordsChanged,
    irpaFitMatches: crawlResult.irpaFitMatches,
    publicOpportunityAiTest: "passed",
    publicOpportunityTitle: candidate.title,
    publicOpportunityGeography: assessment.geographic_eligibility.status,
    publicOpportunityEligibility: assessment.eligibility.status,
    southAfricaExclusionTest: "passed",
    ineligibleConceptNoteBlock: "passed",
    secretsPrinted: false
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || "Staging eligibility smoke test failed.");
  process.exit(1);
});
