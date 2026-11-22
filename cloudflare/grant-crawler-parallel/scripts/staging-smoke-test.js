import { readFileSync } from "node:fs";

let lastCrawlResult = null;

async function main() {
  const raw = readFileSync(0, "utf8");
  const crawlResult = JSON.parse(raw);
  lastCrawlResult = crawlResult;
  if (crawlResult.status === 503 || crawlResult.error === "D1 daily limit reached") {
    console.log(JSON.stringify({ diagnostics: "skipped", reason: "D1 daily limit reached", secretsPrinted: false }));
    return;
  }
  const workerUrl = String(process.env.PRODUCTION_WORKER_URL || process.env.STAGING_WORKER_URL || "").replace(/\/+$/, "");
  const token = String(process.env.GRANT_CRAWLER_CONTROL_TOKEN || "");
  if (!/^https:\/\//i.test(workerUrl)) throw new Error("Crawler worker URL must be HTTPS.");
  if (token.length < 32) throw new Error("Crawler control token is missing or too short.");
  if (crawlResult.status !== "success") throw new Error("Crawler failed: " + String(crawlResult.error || crawlResult.status || "unknown error"));
  if (!Number(crawlResult.feedsConfigured)) throw new Error("No official feeds are configured.");

  const expectedScanners = [
    "japan_embassy", "canada_funding", "usadf_grants", "un_tanzania",
    "undp_tanzania", "gef_small_grants", "fao_funding", "eu_tanzania",
    "tanzania_forest_fund", "world_bank_funding", "fundsforngos_latest",
    "fundsforngos_africa", "fundsforngos_tanzania", "fundsforngos_news",
    "africanngos_roundups", "ngo_portal_africa", "awdf_grants",
    "urgent_action_fund_africa", "rufford_grants", "awhf_grants",
    "gfcf_grants", "mbz_species_grants", "africa_climate_change_fund",
    "global_eba_fund", "climate_justice_resilience_fund", "whitley_fund_for_nature"
  ];
  const scanners = Array.isArray(crawlResult.additionalScanners) ? crawlResult.additionalScanners : [];
  const scheduledScanners = Array.isArray(crawlResult.additionalScannersScheduled) ? crawlResult.additionalScannersScheduled : [];
  const scannerReport = {
    expected: expectedScanners.length,
    configured: crawlResult.additionalScannersConfigured ?? 0,
    scheduledCount: scheduledScanners.length,
    scheduledScanners,
    actualEntries: scanners.length,
    engines: scanners.map(scanner => ({
      engine: scanner.engine,
      status: scanner.status,
      configured: scanner.configured,
      pagesScanned: scanner.pagesScanned,
      httpStatus: scanner.httpStatus,
      primaryHttpStatus: scanner.primaryHttpStatus,
      primarySourceError: scanner.primarySourceError,
      fallbackProvider: scanner.fallbackProvider,
      found: scanner.found,
      candidatesAfterDeduplication: scanner.candidatesAfterDeduplication,
      sharedRegisterWrites: scanner.sharedRegisterWrites,
      errors: scanner.errors || scanner.error || null
    }))
  };
  // Print the actual per-engine run evidence before applying the acceptance gate.
  console.log("DONOR_SCANNER_LIVE_EVIDENCE " + JSON.stringify(scannerReport));
  const observedNames = new Set(scanners.map(scanner => scanner.engine));
  const missing = scheduledScanners.filter(name => !observedNames.has(name));
  const unexpected = scanners.map(scanner => scanner.engine).filter(name => !expectedScanners.includes(name));
  if (Number(crawlResult.additionalScannersConfigured) !== expectedScanners.length ||
      scheduledScanners.length !== Math.min(14, expectedScanners.length) ||
      scanners.length !== scheduledScanners.length || missing.length || unexpected.length) {
    throw new Error("Donor scanner acceptance failed: expected the complete 26-source registry and all scheduled scanner runs; missing: " + (missing.join(", ") || "count mismatch"));
  }
  const failed = scanners.filter(scanner =>
    scanner.configured !== 1 ||
    !Number(scanner.pagesScanned) ||
    scanner.status !== "success" ||
    Number(scanner.httpStatus) < 200 || Number(scanner.httpStatus) >= 300
  );
  if (failed.length) {
    throw new Error("Donor scanner live-fetch acceptance failed (HTTP status must be 2xx): " + failed.map(scanner =>
      scanner.engine + " status=" + scanner.status +
      " pagesScanned=" + scanner.pagesScanned +
      " httpStatus=" + scanner.httpStatus +
      " error=" + JSON.stringify(scanner.errors || scanner.error || null)
    ).join(" | "));
  }

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

  // Geography is advisory for drafting: preserve the ineligible finding, but allow
  // a review draft so IRPA can assess the official call and correct any source errors.
  // Workers AI may transiently return an eligibility assessment without a draft.
  // Retry the authenticated staging request a bounded number of times; never treat
  // a missing draft as success and preserve the geographic exclusion assertion.
  let reviewDraftResponse = null;
  let reviewDraftBody = {};
  let reviewDraftFailure = "missing draft or advisory eligibility result";
  for (let attempt = 0; attempt < 3; attempt++) {
    reviewDraftResponse = await fetch(workerUrl + "/assistant/analyze", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...southAfricaFixture, task: "concept_note" })
    });
    reviewDraftBody = await reviewDraftResponse.json().catch(() => ({}));
    const validReviewDraft = reviewDraftResponse.ok &&
      reviewDraftBody.service === "irpa-grant-application-assistant" &&
      reviewDraftBody.assessment?.geographic_eligibility?.status === "ineligible" &&
      typeof reviewDraftBody.assessment?.concept_note?.draft === "string" &&
      reviewDraftBody.assessment.concept_note.draft.trim().length >= 100;
    if (validReviewDraft) break;
    reviewDraftFailure = String(reviewDraftBody.error || "missing draft or advisory eligibility result").slice(0, 240);
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  if (!reviewDraftResponse?.ok ||
      reviewDraftBody.service !== "irpa-grant-application-assistant" ||
      reviewDraftBody.assessment?.geographic_eligibility?.status !== "ineligible" ||
      typeof reviewDraftBody.assessment?.concept_note?.draft !== "string" ||
      reviewDraftBody.assessment.concept_note.draft.trim().length < 100) {
    throw new Error("The South Africa-only review-draft test failed after 3 bounded attempts: preserve the geographic warning while returning a usable concept-note draft. HTTP " +
      reviewDraftResponse?.status + "; " + reviewDraftFailure);
  }

  console.log(JSON.stringify({
    crawlerStatus: crawlResult.status,
    feedsConfigured: crawlResult.feedsConfigured,
    sourcePagesConfigured: crawlResult.sourcePagesConfigured,
    additionalScannersConfigured: crawlResult.additionalScannersConfigured,
    additionalScanners: crawlResult.additionalScanners,
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
    ineligibleOpportunityReviewDraft: "passed",
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
      additionalScannersConfigured: crawl.additionalScannersConfigured ?? 0,
      additionalScannersScheduled: crawl.additionalScannersScheduled || [],
      additionalScanners: crawl.additionalScanners || [],
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
