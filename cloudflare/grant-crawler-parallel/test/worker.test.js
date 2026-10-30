import test from "node:test";
import { webcrypto } from "node:crypto";
import assert from "node:assert/strict";
import worker, { assessFit, isCurrentOpportunity, parseFeed, safeUrl, listOpportunities } from "../src/index.js";
import { assessGeographicEligibility } from "../src/assistant.js";
import { DONOR_SCANNERS, SEARCH_QUERIES, GDELT_QUERIES, decodeHtml, normalizeOpportunityUrl, parseOfficialPage, parseSearchRss, readDonorScanner, readOfficialPages, readWebSearch, readGdeltSearch, searchFundraisingSources } from "../src/discovery-engines.js";

test("expanded engine registry includes African NGO aggregators and conservation funders", () => {
  const names = new Set(DONOR_SCANNERS.map(scanner => scanner.name));
  for (const name of ["fundsforngos_latest", "fundsforngos_africa", "africanngos_roundups", "ngo_portal_africa", "awdf_grants", "urgent_action_fund_africa", "rufford_grants", "awhf_grants", "gfcf_grants", "mbz_species_grants"]) {
    assert.ok(names.has(name), "missing configured discovery engine: " + name);
  }
  assert.ok(DONOR_SCANNERS.every(scanner => scanner.url.startsWith("https://")));
  assert.ok(SEARCH_QUERIES.length >= 12);
  assert.ok(GDELT_QUERIES.length >= 6);
  const expandedQueries = SEARCH_QUERIES.join(" ").toLowerCase();
  for (const term of ["youth", "livelihoods", "renewable energy", "solar", "pastoralism", "rangeland", "livestock", "fodder", "animal health", "market access", "value addition", "gender equality", "social inclusion", "Indigenous Peoples", "rolling call", "rolling basis", "capacity building", "seed funding", "year-round applications", "closing date", "application deadline"]) {
    assert.ok(expandedQueries.includes(term.toLowerCase()), "missing expanded search term: " + term);
  }
  const rollingCallResults = parseSearchRss('<rss><channel><item><title>Seed Funding on a Rolling Basis for Capacity Building</title><link>https://donor.example/rolling-call</link><description>Ongoing applications accepted year-round for community capacity building.</description></item></channel></rss>', "rolling seed funding");
  assert.equal(rollingCallResults.length, 1);
  assert.match(rollingCallResults[0].title, /Rolling Basis/);
  assert.equal(new Set(DONOR_SCANNERS.map(scanner => scanner.name)).size, DONOR_SCANNERS.length);
});

test("GDELT discovery queries cover IRPA themes and records results as verification leads", async () => {
  assert.ok(GDELT_QUERIES.some(query => /rangeland|pastoralism/i.test(query)));
  assert.ok(GDELT_QUERIES.some(query => /livestock|veterinary/i.test(query)));
  assert.ok(GDELT_QUERIES.some(query => /market access|value addition/i.test(query)));
  assert.ok(GDELT_QUERIES.some(query => /rolling|year-round|no fixed deadline/i.test(query)));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.match(String(url), /api\.gdeltproject\.org\/api\/v2\/doc\/doc/);
    return new Response(JSON.stringify({ articles: [{
      title: "Call for Proposals: Rangeland Restoration Grant",
      url: "https://donor.example/rangeland-call",
      seendate: "20261012T120000Z",
      domain: "donor.example",
      sourceCountry: "Tanzania",
      language: "English"
    }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await readGdeltSearch();
    assert.equal(result.stats.provider, "GDELT DOC API");
    assert.ok(result.stats.queries > 0);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].discoveryEngine, "gdelt_search");
    assert.match(result.items[0].discoveryEvidence, /verify/i);
    assert.equal(result.items[0].publishedAt, "2026-10-12T12:00:00Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("authorised full-catalogue search requests every web and GDELT query", async () => {
  const originalFetch = globalThis.fetch;
  let webRequests = 0, gdeltRequests = 0;
  globalThis.fetch = async url => {
    const target = String(url);
    if (target.includes("api.search.brave.com/res/v1/web/search")) {
      webRequests++;
      return new Response(JSON.stringify({ web: { results: [] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("api.gdeltproject.org/api/v2/doc/doc")) {
      gdeltRequests++;
      return new Response(JSON.stringify({ articles: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("Unexpected provider in full-catalogue test: " + target);
  };
  try {
    const web = await readWebSearch({ BRAVE_SEARCH_API_KEY: "test-key" }, { fullCatalog: true });
    const gdelt = await readGdeltSearch({ fullCatalog: true });
    assert.equal(web.stats.queries, SEARCH_QUERIES.length);
    assert.equal(web.stats.queryCatalogSize, SEARCH_QUERIES.length);
    assert.equal(web.stats.fullCatalog, true);
    assert.equal(webRequests, SEARCH_QUERIES.length);
    assert.equal(gdelt.stats.queries, GDELT_QUERIES.length);
    assert.equal(gdelt.stats.queryCatalogSize, GDELT_QUERIES.length);
    assert.equal(gdelt.stats.fullCatalog, true);
    assert.equal(gdeltRequests, GDELT_QUERIES.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts only credential-free HTTPS feed URLs", () => {
  assert.equal(safeUrl("https://example.org/feed.xml").hostname, "example.org");
  assert.throws(() => safeUrl("http://example.org/feed.xml"));
  assert.throws(() => safeUrl("https://user:pass@example.org/feed.xml"));
  assert.throws(() => safeUrl("https://example.org:8443/feed.xml"));
});

test("parses RSS entries and escapes without executing markup", () => {
  const xml = '<?xml version="1.0"?><rss><channel><item><title>Grant &amp; Call</title><link>https://donor.example/call/1</link><description><![CDATA[Support <b>pastoral</b> communities]]></description><pubDate>Fri, 09 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>';
  const items = parseFeed(xml, "https://donor.example/feed.xml");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Grant & Call");
  assert.equal(items[0].description, "Support pastoral communities");
  assert.equal(items[0].url, "https://donor.example/call/1");
});

test("health endpoint reports identity and Cloudflare storage boundaries without exposing secrets", async () => {
  const response = await worker.fetch(new Request("https://crawler.example/health"), {
    IRPA_ENVIRONMENT: "staging",
    CRAWLER_CONTROL_TOKEN: "never-echo-this-token",
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.identity, "firebase-id-token-verification-only");
  assert.equal(body.draftStorage, "cloudflare-d1");
  assert.equal(JSON.stringify(body).includes("never-echo-this-token"), false);
});

test("crawl endpoint rejects unauthenticated requests", async () => {
  const response = await worker.fetch(new Request("https://crawler.example/crawl", { method: "POST" }), {});
  assert.equal(response.status, 401);
});


test("IRPA fit matcher prioritizes pastoral and rangeland calls without claiming legal eligibility", () => {
  const fit = assessFit({
    title: "Community-led rangeland restoration and drought resilience",
    description: "Eligible applicants must be registered NGOs in Tanzania. Supporting pastoralist livelihoods, women and youth groups.",
  });
  assert.equal(fit.fitAssessment, "strong_topic_match");
  assert.ok(fit.score >= 35);
  assert.ok(fit.reasons.includes("pastoralism/rangelands"));
  assert.equal(fit.eligibilityStatus, "unverified");
});

test("generic unrelated call is low topic match and eligibility remains unverified", () => {
  const fit = assessFit({ title: "University arts fellowship", description: "Performing arts scholarship." });
  assert.equal(fit.fitAssessment, "low_topic_match");
  assert.equal(fit.eligibilityStatus, "geography_unverified");
});


test("closed and country-specific opportunities are not promoted as IRPA priorities", () => {
  const closed = assessFit({
    title: "Closed: Climate adaptation grant in Kenya",
    description: "Fund state: Closed. Supporting climate resilience and livelihoods.",
  });
  assert.equal(closed.callStatus, "closed");
  assert.equal(closed.triageAssessment, "closed_do_not_prioritize");

  const regional = assessFit({
    title: "Open: Community-led restoration across East Africa",
    description: "Fund state: Open. Supporting rangelands and pastoralist livelihoods.",
  });
  assert.equal(regional.callStatus, "open");
  assert.equal(regional.geographyAssessment, "regional_or_lmic_scope");
  assert.equal(regional.triageAssessment, "priority_for_eligibility_review");

  const otherCountry = assessFit({
    title: "Livelihood resilience programme in Uganda",
    description: "Supporting community livelihoods and climate adaptation in Uganda only.",
  });
  assert.equal(otherCountry.geographyAssessment, "other_country_focus");
  assert.equal(otherCountry.triageAssessment, "geographic_mismatch_review");
});


test("announcements with no deadline and unverified current status remain visible for review", () => {
  const unverified = assessFit({
    title: "Pastoral resilience grant across East Africa",
    description: "Supports pastoral communities and climate resilience."
  });
  assert.equal(unverified.callStatus, "unknown");
  assert.equal(unverified.triageAssessment, "status_and_deadline_review");

  const rolling = assessFit({
    title: "Rolling community restoration fund",
    description: "Open on a rolling basis throughout the year for community-led restoration across East Africa."
  });
  assert.equal(rolling.triageAssessment, "priority_for_eligibility_review");
});

test("past advertised deadlines are marked expired even when an open-feed source is used", () => {
  const fit = assessFit({
    title: "Open call for climate resilience grants",
    description: "The call invites proposals by 1 January 2020. Fund state: Open.",
    sourceUrl: "https://www.gov.uk/international-development-funding.atom?fund_state=open",
  });
  assert.equal(fit.deadlineAt, "2020-01-01");
  assert.equal(fit.callStatus, "expired");
  assert.equal(fit.triageAssessment, "closed_do_not_prioritize");
});

test("deadline parser detects closing dates, ISO dates and structured deadline fields", () => {
  const textualClose = assessFit({
    title: "Open climate resilience grant",
    description: "Applications close on 1 January 2020. Fund state: Open."
  });
  assert.equal(textualClose.deadlineAt, "2020-01-01");
  assert.equal(textualClose.callStatus, "expired");
  assert.equal(textualClose.triageAssessment, "closed_do_not_prioritize");

  const isoClose = assessFit({
    title: "Open rangeland restoration grant",
    description: "Closing date: 2020-01-01. Fund state: Open."
  });
  assert.equal(isoClose.deadlineAt, "2020-01-01");
  assert.equal(isoClose.callStatus, "expired");

  const structuredDeadline = assessFit({
    title: "Open livestock market grant",
    description: "Support for livestock value chains.",
    deadline_at: "2020-01-01"
  });
  assert.equal(structuredDeadline.deadlineAt, "2020-01-01");
  assert.equal(structuredDeadline.callStatus, "expired");
});

test("only closed/expired or past-deadline calls are suppressed from the live opportunity list", () => {
  const today = "2026-10-10";
  assert.equal(isCurrentOpportunity({ title: "Old climate grant", description: "Apply by 1 January 2020.", call_status: "open" }, today), false);
  assert.equal(isCurrentOpportunity({ title: "Stale metadata", description: "Climate resilience", call_status: "expired", deadline_at: "2099-12-31" }, today), false);
  assert.equal(isCurrentOpportunity({ title: "Closed announcement", description: "Applications are closed.", call_status: "open", deadline_at: "2099-12-31" }, today), false);
  assert.equal(isCurrentOpportunity({ title: "Unverified call", description: "Community climate support", call_status: "unknown" }, today), true);
  assert.equal(isCurrentOpportunity({ title: "Current call", description: "Deadline for applications is 31 December 2099.", call_status: "unknown", deadline_at: "2099-12-31" }, today), true);
  assert.equal(isCurrentOpportunity({ title: "Rolling call", description: "Applications accepted on a rolling basis.", call_status: "unknown" }, today), true);
  assert.equal(isCurrentOpportunity({ title: "Deadline today", description: "Climate grant", call_status: "unknown", deadline_at: today }, today), true);
});

test("future deadlines can remain open for eligibility review", () => {
  const fit = assessFit({
    title: "Open community rangeland restoration grant",
    description: "Fund state: Open. Deadline for applications is 31 December 2099.",
    sourceUrl: "https://www.gov.uk/international-development-funding.atom?fund_state=open",
  });
  assert.equal(fit.deadlineAt, "2099-12-31");
  assert.equal(fit.callStatus, "open");
});



test("AI geographic classifier requires explicit Tanzania or broad eligible geography", () => {
  assert.equal(assessGeographicEligibility({
    title: "South African NGO grant",
    description: "Only organizations registered in South Africa may apply."
  }).status, "ineligible");
  assert.equal(assessGeographicEligibility({
    title: "Zimbabwe community fund",
    description: "Applications are open only to Zimbabwean registered organizations."
  }).status, "ineligible");
  assert.equal(assessGeographicEligibility({
    title: "East Africa resilience grant",
    description: "Open to civil society organizations across East Africa."
  }).status, "eligible");
  assert.equal(assessGeographicEligibility({
    title: "Community resilience grant",
    description: "Applicants from Tanzania may apply."
  }).status, "eligible");
  assert.equal(assessGeographicEligibility({
    title: "Climate resilience grant",
    description: "A global warming awareness campaign."
  }).status, "unclear");
  assert.equal(assessGeographicEligibility({
    title: "Global Environment Facility small grants in South Africa",
    description: "Eligible applicants must be registered in South Africa as NGOs. Climate resilience and community development."
  }).status, "ineligible");
});

test("country-focused South Africa/Zimbabwe titles cannot be rescued by generic Africa-wide wording", () => {
  const southAfrica = {
    title: "South Africa climate resilience funding opportunity",
    description: "This programme supports applications across Africa, but this listing is focused on South Africa."
  };
  assert.equal(assessGeographicEligibility(southAfrica).status, "ineligible");

  const zimbabwe = {
    title: "Zimbabwe community innovation fund",
    description: "The announcement describes funding across Africa; this specific call is for Zimbabwe-based organizations."
  };
  assert.equal(assessGeographicEligibility(zimbabwe).status, "ineligible");

  const fitSA = assessFit(southAfrica);
  assert.equal(fitSA.geographyAssessment, "other_country_focus");
  assert.equal(fitSA.triageAssessment, "geographic_mismatch_review");

  const fitZW = assessFit(zimbabwe);
  assert.equal(fitZW.geographyAssessment, "other_country_focus");
  assert.equal(fitZW.triageAssessment, "geographic_mismatch_review");
});

test("digital governance and DBGS calls are scored as a distinct strategic investment track", () => {
  const fit = assessFit({
    title: "Digital governance and board management system investment fund",
    description: "Eligible applicants must be registered in Tanzania as NGOs. Support for nonprofit board governance technology, cybersecurity and cloud infrastructure for civil society organizations."
  });
  assert.equal(fit.digitalGovernanceMatch, true);
  assert.equal(fit.strategicTrack, "digital_governance_DBGS_investment");
  assert.ok(fit.reasons.includes("digital governance/DBGS investment"));
  assert.equal(fit.geographyAssessment, "tanzania_mentioned");

  const market = assessFit({
    title: "Pastoral livestock market access and value addition grant",
    description: "Eligible applicants must be registered in Tanzania. Support livestock market linkages, leather processing and market information."
  });
  assert.ok(market.reasons.includes("market development/value addition"));
});

test("strict geographic filter excludes South Africa-only and Zimbabwe-only announcements", () => {
  const southAfrica = assessFit({
    title: "Community grants for South African registered NGOs",
    description: "Applicants must be registered and operating in South Africa. Funding for climate resilience and community livelihoods.",
    sourceUrl: "https://donor.example/calls"
  });
  assert.equal(southAfrica.geographyAssessment, "other_country_focus");
  assert.equal(southAfrica.triageAssessment, "geographic_mismatch_review");
  assert.equal(southAfrica.eligibilityStatus, "geographic_ineligible");

  const southAfricaDonorName = assessFit({
    title: "Global Environment Facility small grants in South Africa",
    description: "Eligible applicants must be registered in South Africa as NGOs. Climate resilience and community development."
  });
  assert.equal(southAfricaDonorName.geographyAssessment, "other_country_focus");
  assert.equal(southAfricaDonorName.triageAssessment, "geographic_mismatch_review");

  const zimbabwe = assessFit({
    title: "Zimbabwean civil society innovation fund",
    description: "Only organizations registered in Zimbabwe may apply. Digital transformation and community development.",
    sourceUrl: "https://donor.example/calls"
  });
  assert.equal(zimbabwe.geographyAssessment, "other_country_focus");
  assert.equal(zimbabwe.triageAssessment, "geographic_mismatch_review");
  assert.equal(zimbabwe.eligibilityStatus, "geographic_ineligible");
});

test("strict geographic filter suppresses calls whose eligible geography is unstated", () => {
  const fit = assessFit({
    title: "Climate resilience small grants",
    description: "Support for community-led restoration and youth innovation.",
    sourceUrl: "https://donor.example/calls"
  });
  assert.equal(fit.geographyAssessment, "not_stated");
  assert.equal(fit.triageAssessment, "eligibility_review_required");
  assert.equal(fit.eligibilityStatus, "geography_unverified");
});

test("strict geographic filter retains explicit Tanzania and broad eligible regions", () => {
  const tanzania = assessFit({
    title: "Tanzania NGO climate resilience grant",
    description: "Eligible applicants must be registered in Tanzania and serve local communities."
  });
  assert.equal(tanzania.geographyAssessment, "tanzania_mentioned");
  assert.equal(tanzania.eligibilityStatus, "unverified");

  const regional = assessFit({
    title: "East Africa community resilience funding",
    description: "Open to civil society organizations across East Africa.",
    sourceUrl: "https://donor.example/calls?fund_state=open"
  });
  assert.equal(regional.geographyAssessment, "regional_or_lmic_scope");
  assert.equal(regional.triageAssessment, "priority_for_eligibility_review");
});

test("geographic eligibility is advisory and does not block concept-note drafting", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  let modelCalls = 0;
  const env = { CRAWLER_CONTROL_TOKEN: token, AI: { run: async () => { modelCalls++; return { response: JSON.stringify({ eligibility: { status: "possibly_eligible", confidence: "low", evidence: [], unknowns: ["Confirm donor rules"] }, donor_requirements: [], concept_note: { draft: "Draft for review" } }) }; } } };
  const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
  for (const opportunity of [
    { title: "South African NGO grant", description: "Only organizations registered in South Africa may apply." },
    { title: "Climate grant", description: "Supports community climate adaptation." }
  ]) {
    const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
      method: "POST", headers,
      body: JSON.stringify({ task: "concept_note", callStatus: "open", ...opportunity })
    }), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(["eligible", "possibly_eligible", "ineligible", "insufficient_information"].includes(body.assessment.eligibility.status));
    assert.ok(["eligible", "ineligible", "unclear"].includes(body.assessment.geographic_eligibility.status));
  }
  assert.equal(modelCalls, 2);
});

test("concept-note analysis returns a safe review scaffold when AI omits draft fields", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  const env = { CRAWLER_CONTROL_TOKEN: token, AI: { run: async () => ({
    response: JSON.stringify({
      eligibility: { status: "ineligible", confidence: "high", evidence: ["South Africa-only restriction"], unknowns: [] },
      donor_requirements: [],
      concept_note: {}
    })
  }) } };
  const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({
      task: "concept_note",
      callStatus: "open",
      title: "South Africa-only NGO climate grant",
      description: "Only organizations registered in South Africa may apply. Funding supports community climate resilience.",
      donorRequirements: "Only South African registered NGOs are eligible.",
      url: "https://example.org/call"
    })
  }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.assessment.geographic_eligibility.status, "ineligible");
  assert.equal(body.assessment.concept_note.draft_source, "deterministic_fallback");
  assert.equal(body.assessment.concept_note.requires_human_completion, true);
  assert.match(body.assessment.concept_note.draft, /IMPORTANT GEOGRAPHIC ELIGIBILITY WARNING/);
  assert.match(body.assessment.concept_note.draft, /must not be invented|do not invent/i);
  assert.ok(body.assessment.concept_note.draft.length > 500);
});

test("known IRPA eligibility gaps are reported without blocking concept-note drafting", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  let modelCalls = 0;
  const env = { CRAWLER_CONTROL_TOKEN: token, AI: { run: async () => {
    modelCalls++;
    return { response: JSON.stringify({ eligibility: { status: "possibly_eligible", confidence: "low", evidence: [], unknowns: ["Verify requirements"] }, donor_requirements: [], concept_note: { draft: "Draft for review" } }) };
  } } };
  const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
  for (const item of [
    { title: "East Africa civil society grant", description: "Open to eligible civil society organizations across East Africa.", donorRequirements: "Applicants must be registered in Tanzania as NGOs and must have completed at least two projects." },
    { title: "East Africa resilience grant", description: "Open to eligible applicants across East Africa.", donorRequirements: "Applicants must be registered in Tanzania as NGOs and provide 20% cash co-financing." },
    { title: "East Africa community grant", description: "Open to eligible applicants across East Africa.", donorRequirements: "Applicants must be registered in Tanzania as NGOs and the organization must have been registered for at least 5 years." },
    { title: "East Africa public services grant", description: "Open to eligible applicants across East Africa.", donorRequirements: "Only government agencies may apply." },
    { title: "East Africa ICCA conservation grant", description: "Open to eligible applicants across East Africa.", donorRequirements: "Applicants must be registered in Tanzania as NGOs. CSOs with over three years of proven evidence of working in or near an ICCA are eligible." }
  ]) {
    const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
      method: "POST", headers, body: JSON.stringify({ task: "concept_note", callStatus: "open", ...item })
    }), env);
    assert.equal(response.status, 200, item.title);
    const body = await response.json();
    assert.ok(body.assessment.known_eligibility_gaps);
    assert.ok(body.assessment.concept_note?.draft);
  }
  assert.equal(modelCalls, 5);
});
test("AI eligibility and concept-note endpoint block expired and explicitly closed calls before model invocation", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  let modelCalls = 0;
  const env = { CRAWLER_CONTROL_TOKEN: token, AI: { run: async () => {
    modelCalls++;
    return { response: JSON.stringify({ eligibility: { status: "eligible", confidence: "high", evidence: [], unknowns: [] }, donor_requirements: [] }) };
  } } };
  const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
  for (const body of [
    { task: "concept_note", title: "East Africa climate grant", description: "Open to civil society applicants across East Africa.", deadline: "2020-01-01", callStatus: "open" },
    { task: "eligibility", title: "East Africa livestock grant", description: "Open to applicants across East Africa.", callStatus: "closed" },
    { task: "concept_note", title: "Climate resilience grant", description: "Applications close on 1 January 2020. Open to applicants across East Africa." }
  ]) {
    const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
      method: "POST", headers, body: JSON.stringify(body)
    }), env);
    const result = await response.json();
    assert.equal(response.status, 422);
    assert.equal(result.call_status, "expired");
    assert.ok(result.expiry_assessment?.reason);
  }
  assert.equal(modelCalls, 0, "AI generation must not run for closed or expired calls.");
});

test("AI cannot mark a call eligible when geographic eligibility is unstated", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  const env = { CRAWLER_CONTROL_TOKEN: token, AI: { run: async () => ({ response: JSON.stringify({
    eligibility: { status: "eligible", confidence: "high", evidence: ["Model guess"], unknowns: [] },
    donor_requirements: []
  }) }) } };
  const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ title: "Global warming awareness grant", description: "Supports community education." })
  }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.assessment.geographic_eligibility.status, "unclear");
  assert.equal(body.assessment.eligibility.status, "insufficient_information");
});

test("AI eligibility analysis deterministically overrides model claims for country-restricted calls", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  const env = { CRAWLER_CONTROL_TOKEN: token, AI: { run: async () => ({ response: JSON.stringify({
    eligibility: { status: "eligible", confidence: "high", evidence: ["The model guessed eligible"], unknowns: [] },
    donor_requirements: []
  }) }) } };
  const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ title: "Zimbabwe grant", description: "Only organizations registered in Zimbabwe may apply." })
  }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.assessment.geographic_eligibility.status, "ineligible");
  assert.equal(body.assessment.eligibility.status, "ineligible");
});


test("AI grant assistant is authenticated and returns structured eligibility analysis", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  let usedModel = "";
  const mockAnalysis = {
    summary: "Potential fit; verify the official guidelines.",
    eligibility: { status: "possibly_eligible", confidence: "medium", evidence: ["Tanzania is in the stated geography"], unknowns: ["Minimum organizational age"] },
    strategic_alignment: { relevant_pillars: ["Sustainable Rangeland Management"], relevant_cross_cutting_themes: ["climate change adaptation and resilience"], pillar_theme_alignment: [{ pillar: "Sustainable Rangeland Management", relevant_cross_cutting_themes: ["climate change adaptation and resilience"], rationale: "The call focuses on pastoral resilience." }], digital_governance_relevance: "none", rationale: "Direct thematic fit.", funding_use_fit: ["community-led restoration"] },
    donor_requirements: [{ requirement: "Applicant registered in Tanzania", status: "met", evidence: "Call text states Tanzania", action: "Attach current registration certificate" }],
    concept_note_structure: [{ heading: "Problem statement", purpose: "Describe the challenge", suggested_content: "Pastoral rangeland degradation in Longido", evidence_needed: ["Baseline data"] }],
    application_checklist: ["Confirm deadline"],
    risks_and_gaps: ["Past performance requirements not supplied"],
    next_steps: ["Review official call document"],
    source_caveat: "Assessment based only on supplied text."
  };
  const env = {
    CRAWLER_CONTROL_TOKEN: token,
    AI: { run: async (model, input) => {
      usedModel = model;
      assert.equal(input.messages[0].role, "system");
      assert.ok(input.messages[0].content.includes("Improvement of Rangeland in Pastoral Areas"));
      assert.ok(input.messages[0].content.includes("pillar_theme_alignment"));
      assert.ok(input.messages[0].content.includes("Digital Board Governance System"));
      assert.ok(input.messages[0].content.includes("Market Development"));
      assert.ok(input.messages[0].content.includes("environmental sustainability"));
      assert.deepEqual(input.response_format, { type: "json_object" });
      return { response: JSON.stringify(mockAnalysis) };
    } }
  };
  const denied = await worker.fetch(new Request("https://crawler.example/assistant/analyze", { method: "POST", body: JSON.stringify({ title: "Test grant", description: "Tanzania climate resilience" }) }), env);
  assert.equal(denied.status, 401);

  const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ title: "Rangeland grant", description: "Pastoral resilience", donorRequirements: "Applicants must be registered in Tanzania as NGOs", url: "https://donor.example/call", callStatus: "open" })
  }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.service, "irpa-grant-application-assistant");
  assert.equal(body.assessment.eligibility.status, "possibly_eligible");
  assert.equal(body.assessment.donor_requirements.length, 1);
  assert.equal(usedModel, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
});

test("AI grant assistant accepts object-shaped JSON-mode responses", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({
      title: "Tanzania rangeland grant",
      description: "Eligible applicants must be registered in Tanzania as NGOs.",
      donorRequirements: "Eligible applicants must be registered in Tanzania as NGOs.",
      callStatus: "open"
    })
  }), {
    CRAWLER_CONTROL_TOKEN: token,
    AI: { run: async () => ({ response: {
      eligibility: { status: "possibly_eligible", confidence: "medium", evidence: [], unknowns: ["Confirm minimum organization age"] },
      donor_requirements: [{ requirement: "Tanzania registration", status: "met", evidence: "Call text requires Tanzania registration", action: "Attach registration certificate" }],
      strategic_alignment: { relevant_pillars: ["Sustainable Rangeland Management"], relevant_cross_cutting_themes: ["community participation"], pillar_theme_alignment: [], digital_governance_relevance: "none", rationale: "Direct fit", funding_use_fit: [] }
    } }) }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.assessment.eligibility.status, "possibly_eligible");
  assert.equal(body.assessment.geographic_eligibility.status, "eligible");
});

test("AI grant assistant validates required input and URL", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  const env = { CRAWLER_CONTROL_TOKEN: token, AI: { run: async () => { throw new Error("must not run"); } } };
  const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
  const missing = await worker.fetch(new Request("https://crawler.example/assistant/analyze", { method: "POST", headers, body: JSON.stringify({ title: "Grant" }) }), env);
  assert.equal(missing.status, 400);
  const unsafe = await worker.fetch(new Request("https://crawler.example/assistant/analyze", { method: "POST", headers, body: JSON.stringify({ title: "Grant", description: "Details", url: "http://example.org/call" }) }), env);
  assert.equal(unsafe.status, 400);
});

test("AI grant assistant fails closed when Cloudflare AI binding is absent", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ title: "Grant", description: "Details" })
  }), { CRAWLER_CONTROL_TOKEN: token });
  assert.equal(response.status, 503);
});


test("grant application portal exposes a live open-calls dashboard and read-only access boundary", async () => {
  const response = await worker.fetch(new Request("https://crawler.example/application"), {});
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Live eligible open calls/);
  assert.match(html, /refreshOpportunities/);
  assert.match(html, /setInterval\(\(\)=>\{if\(currentUser\)loadOpportunities\(\)\},60000\)/);
  assert.match(html, /saved application drafts remain editable only by their responsible owner/i);
});

test("grant application portal serves the authenticated copy-ready workspace", async () => {
  const response = await worker.fetch(new Request("https://crawler.example/application"), {});
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(html, /Copy all application wording/);
  assert.match(html, /Save \/ synchronize draft/);
  assert.match(html, /existing IRPA Digital Board Governance System account/);
});

test("grant application draft records require an authenticated Firebase identity", async () => {
  const response = await worker.fetch(new Request("https://crawler.example/application/drafts", {
    method: "GET"
  }), {});
  assert.equal(response.status, 401);
});

test("concept-note audit trail requires an authenticated draft owner", async () => {
  const response = await worker.fetch(new Request("https://crawler.example/application/drafts/draft-123456/events", {
    method: "GET"
  }), {});
  assert.equal(response.status, 401);
});

test("application draft routes are available without exposing crawler control token", async () => {
  const token = "private-control-token-that-must-not-be-rendered";
  const response = await worker.fetch(new Request("https://crawler.example/application"), { CRAWLER_CONTROL_TOKEN: token });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(html.includes(token), false);
});

test("country-focused calls are suppressed even when descriptions contain generic regional wording", () => {
  const kenya = assessFit({
    title: "Kenya climate resilience grant",
    description: "Funding is available across Africa, but this specific call is for Kenya-based organizations."
  });
  assert.equal(kenya.geographyAssessment, "other_country_focus");
  assert.equal(kenya.eligibilityStatus, "geographic_ineligible");
  assert.equal(kenya.triageAssessment, "geographic_mismatch_review");

  const tanzaniaEligible = assessFit({
    title: "Kenya and Tanzania community resilience programme",
    description: "This call explicitly accepts applications from Tanzania-based NGOs; funding is available across East Africa."
  });
  assert.notEqual(tanzaniaEligible.geographyAssessment, "other_country_focus");
});

test("open-feed metadata cannot bypass expiry filtering", () => {
  assert.equal(isCurrentOpportunity({
    title: "Past-deadline rangeland grant",
    description: "Fund state: Open. Deadline for applications is 1 January 2000.",
    call_status: "open",
    deadline_at: "2000-01-01"
  }), false);

  assert.equal(isCurrentOpportunity({
    title: "Future rangeland grant",
    description: "Fund state: Open. Deadline for applications is 31 December 2099.",
    call_status: "open",
    deadline_at: "2099-12-31"
  }), true);
});

test("country-focused calls remain available for drafting with advisory geography", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  let modelCalls = 0;
  const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({
      task: "concept_note", callStatus: "open",
      title: "Kenya climate resilience grant",
      description: "Funding is available across Africa, but this specific call is for Kenya-based organizations."
    })
  }), {
    CRAWLER_CONTROL_TOKEN: token,
    AI: { run: async () => { modelCalls++; return { response: JSON.stringify({ eligibility: { status: "possibly_eligible", confidence: "low", evidence: [], unknowns: ["Verify official call"] }, donor_requirements: [], concept_note: { draft: "Draft for review" } }) }; } }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).assessment.geographic_eligibility.status, "ineligible");
  assert.equal(modelCalls, 1);
});


test("parallel discovery URL normalization strips tracking parameters and rejects unsafe URLs", () => {
  assert.equal(normalizeOpportunityUrl("https://donor.example/call?id=3&utm_source=newsletter#apply"), "https://donor.example/call?id=3");
  assert.throws(() => normalizeOpportunityUrl("http://donor.example/call"));
  assert.throws(() => normalizeOpportunityUrl("https://user:secret@donor.example/call"));
  assert.throws(() => normalizeOpportunityUrl("https://127.0.0.1/private"));
});

test("official webpage parser extracts safe title and description text", () => {
  const item = parseOfficialPage('<html><head><title>Grant &amp; Funding Call</title><meta name="description" content="Support pastoral livelihoods"></head><body><script>secret()</script><p>Open grant for restoration</p></body></html>', "https://donor.example/grants?utm_campaign=x");
  assert.equal(item.title, "Grant & Funding Call");
  assert.match(item.description, /Support pastoral livelihoods/);
  assert.doesNotMatch(item.description, /secret\(\)/);
  assert.equal(item.url, "https://donor.example/grants");
  assert.equal(decodeHtml("Women &amp; youth"), "Women & youth");
});

test("registers twenty-six independent donor scanners with official HTTPS sources", () => {
  assert.equal(DONOR_SCANNERS.length, 26);
  assert.equal(new Set(DONOR_SCANNERS.map(scanner => scanner.name)).size, 26);
  for (const name of ["fundsforngos_latest", "fundsforngos_africa", "fundsforngos_tanzania", "fundsforngos_news", "africa_climate_change_fund", "global_eba_fund", "climate_justice_resilience_fund", "whitley_fund_for_nature"]) {
    assert.ok(DONOR_SCANNERS.some(scanner => scanner.name === name));
  }
  for (const scanner of DONOR_SCANNERS) {
    assert.equal(new URL(scanner.url).protocol, "https:");
    assert.ok(scanner.label.length > 3);
  }
});

test("donor scanner returns opportunities in the shared candidate shape", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html><head><title>Call for Proposals: Pastoral Resilience Grant</title><meta name="description" content="Funding opportunity for community rangeland restoration in Tanzania. Applications close 30 December 2026."></head><body>Funding opportunity for community rangeland restoration in Tanzania. Applications close 30 December 2026.</body></html>', { status: 200, headers: { "content-type": "text/html" } });
  try {
    const result = await readDonorScanner({ name: "test_donor", label: "Test Donor", url: "https://example.org/grants" });
    assert.equal(result.stats.configured, 1);
    assert.equal(result.stats.pagesScanned, 1);
    assert.equal(result.stats.httpStatus, 200);
    assert.equal(result.stats.found, result.items.length);
    assert.equal(result.stats.errors.length, 0);
    assert.ok(result.items.length >= 1);
    assert.equal(result.items[0].discoveryEngine, "test_donor");
    assert.equal(result.items[0].sourceUrl, "https://example.org/grants");
    assert.match(result.items[0].title, /Call for Proposals/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("FundsforNGOs scanner sends opportunity URL to original issuer, not aggregator article", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (url === "https://www2.fundsforngos.org/") {
      return new Response('<html><head><title>FundsforNGOs</title></head><body><a href="https://www2.fundsforngos.org/listing/open-grant-call/">Open Grant Funding Opportunity</a></body></html>', { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url === "https://www2.fundsforngos.org/listing/open-grant-call/") {
      return new Response('<html><head><title>Open Grant Funding Opportunity for Tanzania</title><meta name="description" content="Call for proposals funding community rangeland restoration in Tanzania. Applications close 30 December 2026."></head><body><p>Call for proposals funding community rangeland restoration in Tanzania. Applications close 30 December 2026.</p><a href="https://original-donor.example/calls/2026">Apply now at official donor website</a></body></html>', { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error("Unexpected URL " + url);
  };
  try {
    const result = await readDonorScanner({ name: "fundsforngos_latest", label: "FundsforNGOs Latest Funding Opportunities", url: "https://www2.fundsforngos.org/" });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].url, "https://original-donor.example/calls/2026");
    assert.equal(result.items[0].originalOpportunityUrl, "https://original-donor.example/calls/2026");
    assert.equal(result.items[0].discoverySourceUrl, "https://www2.fundsforngos.org/");
    assert.notEqual(result.items[0].url, "https://www2.fundsforngos.org/listing/open-grant-call/");
    assert.equal(result.stats.detailPagesScanned, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AfricanNGOs and NGO Portal aggregator engines retain original issuer URLs", async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    {
      scanner: { name: "africanngos_roundups", label: "AfricanNGOs Funding Roundups", url: "https://africanngos.org/" },
      article: "https://africanngos.org/2026/open-grant-call/",
      issuer: "https://issuer-africanngos.example/apply"
    },
    {
      scanner: { name: "ngo_portal_africa", label: "NGO Portal Africa Funding Calls", url: "https://jobs.ngoportal.africa/grants-funding/" },
      article: "https://jobs.ngoportal.africa/grants-funding/open-call/",
      issuer: "https://issuer-ngoportal.example/apply"
    }
  ];
  try {
    for (const item of cases) {
      globalThis.fetch = async input => {
        const url = String(input);
        if (url === item.scanner.url) {
          return new Response('<html><head><title>Funding Opportunities</title></head><body><a href="' + item.article + '">Open Grant Funding Opportunity</a></body></html>', { status: 200, headers: { "content-type": "text/html" } });
        }
        if (url === item.article) {
          return new Response('<html><head><title>Open Grant Funding Opportunity for Tanzania</title><meta name="description" content="Call for proposals funding community rangeland restoration in Tanzania. Applications close 30 December 2026."></head><body><p>Call for proposals funding community rangeland restoration in Tanzania. Applications close 30 December 2026.</p><a href="' + item.issuer + '">Apply now at official donor website</a></body></html>', { status: 200, headers: { "content-type": "text/html" } });
        }
        throw new Error("Unexpected URL " + url);
      };
      const result = await readDonorScanner(item.scanner);
      assert.equal(result.items.length, 1, item.scanner.name);
      assert.equal(result.items[0].url, item.issuer, item.scanner.name);
      assert.notEqual(result.items[0].url, item.article, item.scanner.name);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("aggregator without an issuer link records a no-match warning, not a failed engine", async () => {
  const originalFetch = globalThis.fetch;
  const root = "https://jobs.ngoportal.africa/grants-funding/";
  const article = "https://jobs.ngoportal.africa/grants-funding/open-call/";
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === root) return new Response('<html><head><title>Funding Calls</title></head><body><a href="' + article + '">Open Grant Funding Opportunity</a></body></html>', { status: 200, headers: { "content-type": "text/html" } });
    if (url === article) return new Response('<html><head><title>Open Grant Funding Opportunity</title><meta name="description" content="Call for proposals funding community restoration. Applications close 30 December 2026."></head><body><p>Call for proposals funding community restoration. Applications close 30 December 2026.</p></body></html>', { status: 200, headers: { "content-type": "text/html" } });
    if (url.startsWith("https://www.bing.com/search?")) return new Response("<rss><channel></channel></rss>", { status: 200, headers: { "content-type": "application/rss+xml" } });
    throw new Error("Unexpected URL " + url);
  };
  try {
    const result = await readDonorScanner({ name: "ngo_portal_africa", label: "NGO Portal Africa Funding Calls", url: root });
    assert.equal(result.items.length, 0);
    assert.equal(result.stats.errors.length, 0);
    assert.match(result.stats.message, /fallback found no matching call/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web search RSS parser extracts grant announcements and rejects unsafe links", () => {
  const xml = '<rss><channel><item><title>Open grant for pastoral restoration</title><link>https://donor.example/call?utm_source=news</link><description>Funding for rangeland restoration in Tanzania</description><pubDate>Sat, 10 Oct 2026 10:00:00 GMT</pubDate><source url="https://donor.example">Donor</source></item></channel></rss>';
  const items = parseSearchRss(xml, "grant Tanzania");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Open grant for pastoral restoration");
  assert.equal(items[0].url, "https://donor.example/call");
  assert.equal(items[0].discoveryEngine, "web_search");
  assert.equal(items[0].sourceUrl, "https://donor.example/");
});

test("parallel webpage scanner and no-key web search use the configured public search fallback", async () => {
  const pages = await readOfficialPages({ GRANT_SOURCE_PAGE_URLS: "[]" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<rss><channel><item><title>Open grant for pastoral restoration</title><link>https://donor.example/call</link><description>Funding for rangeland restoration in Tanzania</description></item></channel></rss>', { status: 200, headers: { "content-type": "application/rss+xml" } });
  try {
    const search = await readWebSearch({});
    assert.ok(search.items.length >= 3);
    assert.equal(search.stats.configured, true);
    assert.equal(search.stats.provider, "Google News RSS");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(pages.items.length, 0);
  assert.equal(pages.stats.configured, 0);
});


test("AI document drafting route returns a generated draft", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  let modelCalls = 0;
  const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ task: "draft_message", format: "Formal letter", tone: "Professional", length: "Concise", instructions: "Draft a formal letter about a proposed rangeland restoration partnership." })
  }), {
    CRAWLER_CONTROL_TOKEN: token,
    AI: { run: async () => { modelCalls++; return { draft: "Subject: Rangeland restoration partnership\\n\\nDear Partner,\\nIRPA proposes to explore a partnership." }; } }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.task, "draft_message");
  assert.match(body.draft, /rangeland restoration partnership/i);
  assert.equal(modelCalls, 1);
});

test("AI document drafting rejects an empty instruction", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ task: "draft_message", instructions: " " })
  }), { CRAWLER_CONTROL_TOKEN: token, AI: { run: async () => { throw new Error("model must not run"); } } });
  assert.equal(response.status, 400);
});

test("AI document drafting returns a labelled scaffold when the AI binding is missing", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ task: "draft_message", format: "Formal letter", instructions: "Confirm the endpoint is responsive." })
  }), { CRAWLER_CONTROL_TOKEN: token });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.task, "draft_message");
  assert.equal(body.draft_source, "deterministic_fallback");
  assert.equal(body.requires_human_completion, true);
  assert.match(body.draft, /INTERNAL DRAFT SCAFFOLD/);
});

test("AI document drafting returns a clearly labelled scaffold when Workers AI throws", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ task: "draft_message", format: "Formal letter", instructions: "Confirm a proposed rangeland restoration discussion." })
  }), {
    CRAWLER_CONTROL_TOKEN: token,
    AI: { run: async () => { throw new Error("provider details must not be exposed"); } }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.task, "draft_message");
  assert.equal(body.draft_source, "deterministic_fallback");
  assert.equal(body.requires_human_completion, true);
  assert.match(body.draft, /INTERNAL DRAFT SCAFFOLD/);
  assert.match(body.draft, /Confirm a proposed rangeland restoration discussion/);
  assert.doesNotMatch(JSON.stringify(body), /provider details must not be exposed/);
});

test("AI document drafting returns a clearly labelled scaffold for an empty model response", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ task: "draft_message", format: "Formal letter", instructions: "Confirm the assistant is responding." })
  }), {
    CRAWLER_CONTROL_TOKEN: token,
    AI: { run: async () => ({ response: "" }) }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.draft_source, "deterministic_fallback");
  assert.equal(body.requires_human_completion, true);
  assert.ok(body.draft.trim().length >= 30);
});


test("concept-note endpoint composes a draft from generated application fields", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ task: "concept_note", callStatus: "open", title: "Longido Rangeland Restoration", description: "Call for proposals supporting community restoration in Tanzania." })
  }), {
    CRAWLER_CONTROL_TOKEN: token,
    AI: { run: async () => ({ response: JSON.stringify({
      eligibility: { status: "possibly_eligible", confidence: "low", evidence: [], unknowns: ["Confirm donor criteria"] },
      donor_requirements: [],
      concept_note: { application_fields: {
        title: "Longido Rangeland Restoration",
        executive_summary: "A community-led restoration initiative in Longido.",
        problem_statement: "Rangeland condition requires locally led assessment and restoration."
      } }
    }) }) }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.assessment.concept_note.draft, /Longido Rangeland Restoration/);
  assert.match(body.assessment.concept_note.draft, /Executive Summary/);
  assert.match(body.assessment.concept_note.draft, /Problem Statement/);
});


test("on-demand fundraising search combines public search engines and labels leads unverified", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === "news.google.com") return new Response('<rss><channel><item><title>Corporate partnership and CSR funding opportunity for Tanzania NGOs</title><link>https://donor.example/csr-call</link><description>Applications for sponsorship and community resilience partnership.</description><pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate><source url="https://donor.example">Donor Foundation</source></item></channel></rss>', { status: 200, headers: { "content-type": "application/rss+xml" } });
    if (url.hostname === "api.gdeltproject.org") return new Response(JSON.stringify({ articles: [{ title: "Rolling grant funding for pastoral livelihoods", url: "https://funder.example/rolling", domain: "funder.example", seendate: "20261012T120000Z" }] }), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error("Unexpected search provider " + url.hostname);
  };
  try {
    const result = await searchFundraisingSources("pastoral livelihoods", "rolling");
    assert.ok(result.providers.includes("Google News RSS"));
    assert.ok(result.providers.includes("GDELT DOC API"));
    assert.ok(result.items.length >= 2);
    assert.ok(result.items.every(item => item.verificationStatus === "unverified_lead"));
    assert.ok(result.items.some(item => /Corporate partnership/.test(item.title)));
    assert.ok(result.items.some(item => /rolling/i.test(item.deadlineSignal)));
  } finally { globalThis.fetch = originalFetch; }
});


test("fundraising search falls back to Bing when Google has no relevant leads and isolates GDELT timeouts", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === "news.google.com") return new Response("<rss><channel></channel></rss>", { status: 200, headers: { "content-type": "application/rss+xml" } });
    if (url.hostname === "www.bing.com") return new Response('<rss><channel><item><title>Open grant funding for pastoral rangeland restoration in Tanzania</title><link>https://funder.example/bing-call</link><description>Applications open for community-led rangeland restoration.</description><pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>', { status: 200, headers: { "content-type": "application/rss+xml" } });
    if (url.hostname === "api.gdeltproject.org") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    throw new Error("Unexpected search provider " + url.hostname);
  };
  try {
    const result = await searchFundraisingSources("pastoral rangeland", "all");
    assert.ok(result.items.some(item => item.url === "https://funder.example/bing-call"));
    assert.ok(result.items.every(item => item.verificationStatus === "unverified_lead"));
    assert.ok(result.providers.includes("Bing RSS fallback"));
    assert.ok(result.errors.some(item => item.provider === "GDELT DOC API"));
  } finally { globalThis.fetch = originalFetch; }
});

test("fundraising search endpoint accepts control-token smoke auth and returns engine contract", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === "news.google.com") return new Response('<rss><channel><item><title>Rolling grant funding for pastoral livelihoods</title><link>https://funder.example/rolling</link><description>Rolling applications for pastoral resilience.</description></item></channel></rss>', { status: 200, headers: { "content-type": "application/rss+xml" } });
    if (url.hostname === "api.gdeltproject.org") return new Response(JSON.stringify({ articles: [{ title: "Rolling grant funding for pastoral livelihoods", url: "https://funder.example/rolling", domain: "funder.example", seendate: "20261012T120000Z" }] }), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error("Unexpected provider " + url.hostname);
  };
  try {
    const token = "smoke-test-control-token-value-0123456789";
    const response = await worker.fetch(new Request("https://crawler.example/fundraising/search", {
      method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ query: "pastoral livelihoods", mode: "rolling" })
    }), { CRAWLER_CONTROL_TOKEN: token });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.query, "pastoral livelihoods");
    assert.ok(Array.isArray(body.items));
    assert.ok(body.providers.includes("Google News RSS"));
    assert.ok(body.providers.includes("GDELT DOC API"));
  } finally { globalThis.fetch = originalFetch; }
});

async function createPipelineTestToken() {
  const pair = await webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" },
    true, ["sign", "verify"]
  );
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  jwk.kid = "grant-pipeline-test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = encode({ alg: "RS256", typ: "JWT", kid: jwk.kid }) + "." + encode({
    aud: "irpa-digital-board-governance",
    iss: "https://securetoken.google.com/irpa-digital-board-governance",
    sub: "grant-pipeline-test-user",
    iat: now, auth_time: now, exp: now + 3600
  });
  const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(unsigned));
  return { token: unsigned + "." + Buffer.from(signature).toString("base64url"), jwk };
}

function pipelineTestDb(rows = []) {
  return {
    prepare(sql) {
      const statement = {
        all: async () => ({ results: sql.includes("grant_opportunities") ? rows : [] }),
        first: async () => null,
        run: async () => ({ meta: { changes: 1 } }),
        bind: (..._values) => statement
      };
      return statement;
    }
  };
}

test("Grant Pipeline routes expose CORS preflight and reject missing Firebase tokens", async () => {
  const routes = ["/pipeline/calls", "/pipeline/evaluate", "/pipeline/stage", "/pipeline/evidence"];
  for (const path of routes) {
    const preflight = await worker.fetch(new Request("https://crawler.example" + path, { method: "OPTIONS" }), {});
    assert.equal(preflight.status, 204, path + " CORS preflight");
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    const method = path === "/pipeline/calls" || path === "/pipeline/evidence" ? "GET" : "POST";
    const rejected = await worker.fetch(new Request("https://crawler.example" + path, { method }), { GRANTS_DB: pipelineTestDb() });
    assert.equal(rejected.status, 401, path + " auth rejection");
    assert.equal(rejected.headers.get("access-control-allow-origin"), "*");
  }
});

test("Grant Pipeline routes evaluate eligible, conditional, not eligible and expired fixtures and deduplicate calls", async () => {
  const auth = await createPipelineTestToken();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return new Response(JSON.stringify({ keys: [auth.jwk] }), { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=3600" } });
    }
    throw new Error("Unexpected network request in grant pipeline route test.");
  };
  const rows = [
    { id: "eligible-a", title: "Rangeland restoration", description: "Community rangeland restoration.", url: "https://donor.example/eligible", deadline: "2099-12-31", status: "open" },
    { id: "duplicate-a", title: "Duplicate rangeland restoration", url: "https://donor.example/eligible", deadline: "2099-12-31", status: "open" },
    { id: "expired-a", title: "Expired livestock grant", url: "https://donor.example/expired", deadline: "2020-01-01", status: "open" }
  ];
  const env = { GRANTS_DB: pipelineTestDb(rows) };
  const headers = { authorization: "Bearer " + auth.token, "content-type": "application/json" };
  try {
    const listed = await worker.fetch(new Request("https://crawler.example/pipeline/calls", { headers }), env);
    const listBody = await listed.json();
    assert.equal(listed.status, 200);
    assert.equal(listBody.calls.length, 1);
    assert.equal(listBody.duplicates.length, 1);
    assert.equal(listBody.closed.length, 1);

    const fixtures = [
      [{ title: "Tanzania rangeland grant", status: "open", deadline: "2099-12-31", eligibleCountries: ["Tanzania"], applicantTypes: ["NGO"], requiredApplicantTypes: ["NGO"] }, "ELIGIBLE", "CURRENT"],
      [{ title: "Tanzania livestock grant", status: "open", deadline: "2099-12-31", eligibleCountries: ["Tanzania"], applicantTypes: ["NGO"], requiredApplicantTypes: ["NGO"], minimumYearsOperation: 4, minimumBudget: 50000 }, "CONDITIONAL", "CURRENT"],
      [{ title: "Tanzania excluded grant", status: "open", deadline: "2099-12-31", eligibleCountries: ["Tanzania"], excludedCountries: ["Tanzania"] }, "NOT_ELIGIBLE", "CURRENT"],
      [{ title: "Expired pastoral grant", status: "open", deadline: "2020-01-01", eligibleCountries: ["Tanzania"] }, "ELIGIBLE", "CLOSED"]
    ];
    for (const [call, expectedEligibility, expectedValidity] of fixtures) {
      const response = await worker.fetch(new Request("https://crawler.example/pipeline/evaluate", { method: "POST", headers, body: JSON.stringify({ call }) }), env);
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.eligibility.status, expectedEligibility);
      assert.equal(body.validityStatus, expectedValidity);
    }

    const stage = await worker.fetch(new Request("https://crawler.example/pipeline/stage", {
      method: "POST", headers, body: JSON.stringify({ callId: "eligible-a", stage: "screening", notes: "Initial review" })
    }), env);
    assert.equal(stage.status, 200);
    assert.equal((await stage.json()).stage, "screening");

    const evidence = await worker.fetch(new Request("https://crawler.example/pipeline/evidence", {
      method: "POST", headers, body: JSON.stringify({ callId: "eligible-a", claim: "Registration evidence", evidenceText: "Registration certificate reference", sourceLabel: "IRPA registration record" })
    }), env);
    assert.equal(evidence.status, 201);
    assert.equal((await evidence.json()).verified, false);
  } finally { globalThis.fetch = originalFetch; }
});

function opportunityCacheMock() {
  const entries=new Map();
  return {async match(request){const r=entries.get(request.url);return r?r.clone():undefined;},async put(request,response){entries.set(request.url,response.clone());}};
}
function opportunityDbMock(resultsOrError) {
  const calls=[];
  return {calls,prepare(sql){const call={sql,values:null};calls.push(call);return {bind(...values){call.values=values;return this;},async all(){if(resultsOrError instanceof Error)throw resultsOrError;return {results:resultsOrError};}};}};
}
test("GET /opportunities clamps page size, defaults to 50, binds offset and reports hasMore",async()=>{
  const original=globalThis.caches;globalThis.caches={default:opportunityCacheMock()};
  try{
    const db=opportunityDbMock(Array.from({length:101},(_,id)=>({id})));
    const response=await listOpportunities(new Request("https://crawler.example/opportunities?limit=500&offset=25"),{GRANTS_DB:db});
    const body=await response.json();assert.equal(body.limit,100);assert.equal(body.offset,25);assert.equal(body.items.length,100);assert.equal(body.hasMore,true);assert.deepEqual(db.calls[0].values,[101,25]);
    const defaultDb=opportunityDbMock(Array.from({length:51},(_,id)=>({id})));
    const defaultResponse=await listOpportunities(new Request("https://crawler.example/opportunities"),{GRANTS_DB:defaultDb});
    const defaultBody=await defaultResponse.json();assert.equal(defaultBody.limit,50);assert.equal(defaultBody.offset,0);assert.equal(defaultBody.items.length,50);assert.equal(defaultBody.hasMore,true);assert.deepEqual(defaultDb.calls[0].values,[51,0]);
  }finally{if(original===undefined)delete globalThis.caches;else globalThis.caches=original;}
});
test("GET /opportunities cache hit avoids a second D1 prepare",async()=>{
  const original=globalThis.caches;globalThis.caches={default:opportunityCacheMock()};
  try{const db=opportunityDbMock([{id:"cached-row"}]);const req=()=>new Request("https://crawler.example/opportunities?limit=50&offset=0");
    const first=await listOpportunities(req(),{GRANTS_DB:db});assert.equal(first.headers.get("x-cache"),"MISS");
    const second=await listOpportunities(req(),{GRANTS_DB:db});assert.equal(second.headers.get("x-cache"),"HIT");assert.equal(db.calls.length,1);
  }finally{if(original===undefined)delete globalThis.caches;else globalThis.caches=original;}
});
test("GET /opportunities maps D1 limit to 503 and other query errors to 500",async()=>{
  const original=globalThis.caches;globalThis.caches={default:opportunityCacheMock()};
  try{const limited=await listOpportunities(new Request("https://crawler.example/opportunities"),{GRANTS_DB:opportunityDbMock(new Error("D1 daily read limit exceeded"))});
    assert.equal(limited.status,503);assert.deepEqual(await limited.json(),{error:"D1 daily limit reached"});
    const failed=await listOpportunities(new Request("https://crawler.example/opportunities"),{GRANTS_DB:opportunityDbMock(new Error("database unavailable"))});
    assert.equal(failed.status,500);assert.deepEqual(await failed.json(),{error:"Opportunities query failed"});assert.notEqual(failed.status,401);assert.notEqual(failed.status,502);
  }finally{if(original===undefined)delete globalThis.caches;else globalThis.caches=original;}
});
