import { readFileSync } from "node:fs";

let lastCrawlResult = null;

async function main() {
  const raw = readFileSync(0, "utf8");
  const crawlResult = JSON.parse(raw);
  lastCrawlResult = crawlResult;
  const workerUrl = String(process.env.STAGING_WORKER_URL || "").replace(/\/+$/, "");
  const token = String(process.env.GRANT_CRAWLER_CONTROL_TOKEN || "");
  if (!/^https:\/\//i.test(workerUrl)) throw new Error("STAGING_WORKER_URL must be HTTPS.");
  if (token.length < 32) throw new Error("Crawler control token is missing or too short.");
  if (crawlResult.status !== "success") throw new Error("Crawler failed: " + String(crawlResult.error || crawlResult.status || "unknown error"));
  if (!Number(crawlResult.feedsConfigured)) throw new Error("No official feeds are configured.");

  const headers = {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  async function analyze(payload) {
    const response = await fetch(workerUrl + "/assistant/analyze", {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok || body.service !== "irpa-grant-application-assistant") {
      throw new Error("AI opportunity analysis failed with HTTP " + response.status + ": " + String(body.error || "no safe error detail returned").slice(0, 240));
    }
    return body.assessment || {};
  }

  // Public, non-confidential opportunity text from UNDP's 6 October 2026
  // ICCA-GSI Phase 2 announcement. The excerpt does not establish Tanzania
  // eligibility, and it requires over three years of proven CSO track record.
  const publicOpportunity = {
    task: "eligibility",
    title: "UNDP GEF SGP — ICCA-GSI Phase 2 Call for Proposals",
    description: "The public UNDP announcement describes grants for civil society organisations supporting biodiversity conservation, sustainable livelihoods and climate resilience. Regular grants require duly registered local CSOs with over three years of proven evidence of working in or near an Indigenous Peoples and Local Communities Conserved Area or Territory (ICCA), and over three years of proven experience empowering Indigenous Peoples and Local Communities. Applicants must demonstrate cash and in-kind co-financing. The supplied announcement excerpt does not specify an eligible-country list or a submission deadline.",
    donorRequirements: "Regular grants are for duly registered local CSOs with over three years of proven evidence of working in or near an ICCA and over three years of proven experience empowering Indigenous Peoples and Local Communities. Applicants must demonstrate co-financing in cash and in kind. Confirm eligible countries and deadline in the full official call documents.",
    url: "https://www.undp.org/nigeria/news/call-proposals-indigenous-peoples-and-local-communities-conserved-areas-and-territories-global-support-initiative-icca-gsi-phase-2"
  };
  const publicAssessment = await analyze(publicOpportunity);
  if (publicAssessment.geographic_eligibility?.status !== "unclear") {
    throw new Error("The public call's unstated country eligibility was not held for verification.");
  }
  if (publicAssessment.eligibility?.status !== "ineligible") {
    throw new Error("The assistant failed to flag the public call's mandatory multi-year CSO track-record gap for IRPA.");
  }
  if (!(publicAssessment.known_eligibility_gaps?.blockers || []).some(item => /no completed projects/i.test(item))) {
    throw new Error("The assistant did not expose IRPA's lack of completed projects as a track-record blocker.");
  }

  const tanzaniaFixture = {
    task: "eligibility",
    title: "Non-confidential staging fixture: Tanzania-eligible rangeland grant",
    description: "Eligible applicants must be registered in Tanzania as NGOs. The illustrative call supports community-led rangeland restoration and climate resilience.",
    donorRequirements: "Eligible applicants must be registered in Tanzania as NGOs.",
    url: "https://example.org/tanzania-rangeland-grant"
  };
  const tanzaniaAssessment = await analyze(tanzaniaFixture);
  if (tanzaniaAssessment.geographic_eligibility?.status !== "eligible") {
    throw new Error("The assistant did not recognize explicit Tanzania applicant eligibility in the positive staging fixture.");
  }
  if (tanzaniaAssessment.eligibility?.status === "eligible" &&
      ((tanzaniaAssessment.eligibility.unknowns || []).length > 0 ||
       (tanzaniaAssessment.donor_requirements || []).some(row => row.status !== "met"))) {
    throw new Error("AI assistant marked the positive fixture eligible despite unresolved mandatory requirements.");
  }

  const southAfricaFixture = {
    task: "eligibility",
    title: "Non-confidential staging fixture: South Africa-only NGO call",
    description: "Only organizations registered in South Africa may apply. Eligible applicants must be registered in South Africa as NGOs. Funding supports community climate resilience.",
    donorRequirements: "Only South African registered NGOs are eligible.",
    url: "https://www.gov.uk/international-development-funding"
  };
  const southAfricaAssessment = await analyze(southAfricaFixture);
  if (southAfricaAssessment.geographic_eligibility?.status !== "ineligible" ||
      southAfricaAssessment.eligibility?.status !== "ineligible") {
    throw new Error("The assistant failed to reject the South Africa-only fixture.");
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
    sourcePagesConfigured: crawlResult.sourcePagesConfigured,
    webSearchConfigured: crawlResult.webSearchConfigured,
    engines: crawlResult.engines,
    irpaFitMatches: crawlResult.irpaFitMatches,
    topMatches: crawlResult.topMatches,
    itemsSeen: crawlResult.itemsSeen,
    recordsChanged: crawlResult.recordsChanged,
    irpaFitMatches: crawlResult.irpaFitMatches,
    publicOpportunityTitle: publicOpportunity.title,
    publicOpportunityEligibility: publicAssessment.eligibility.status,
    publicOpportunityGeography: publicAssessment.geographic_eligibility.status,
    publicTrackRecordGate: "passed",
    positiveTanzaniaGeographyTest: "passed",
    southAfricaExclusionTest: "passed",
    ineligibleConceptNoteBlock: "passed",
    secretsPrinted: false
  }, null, 2));
}

main().catch(error => {
  const message = String(error.message || "Staging eligibility smoke test failed.");
  if (/4006|daily free allocation of 10,000 neurons|used up your daily free allocation/i.test(message)) {
    const crawl = lastCrawlResult || {};
    console.log(JSON.stringify({
      crawlerStatus: crawl.status || "unknown",
      feedsConfigured: crawl.feedsConfigured || 0,
      sourcePagesConfigured: crawl.sourcePagesConfigured || 0,
      webSearchConfigured: crawl.webSearchConfigured ?? false,
      itemsSeen: crawl.itemsSeen ?? null,
      recordsChanged: crawl.recordsChanged ?? null,
      engines: crawl.engines || [],
      irpaFitMatches: crawl.irpaFitMatches || null,
      topMatches: crawl.topMatches || [],
      aiEligibilitySmokeTest: "skipped_quota_exhausted",
      aiQuotaMessage: message,
      secretsPrinted: false
    }, null, 2));
    process.exit(0);
  }
  console.error(message);
  process.exit(1);
});
