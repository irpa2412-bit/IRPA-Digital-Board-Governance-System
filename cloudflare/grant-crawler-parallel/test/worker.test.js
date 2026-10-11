import test from "node:test";
import assert from "node:assert/strict";
import worker, { assessFit, isCurrentOpportunity, parseFeed, safeUrl } from "../src/index.js";
import { assessGeographicEligibility } from "../src/assistant.js";
import { DONOR_SCANNERS, decodeHtml, normalizeOpportunityUrl, parseOfficialPage, parseSearchRss, readDonorScanner, readOfficialPages, readWebSearch } from "../src/discovery-engines.js";

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


test("announcements with no deadline and no verified current status are suppressed", () => {
  const unverified = assessFit({
    title: "Pastoral resilience grant across East Africa",
    description: "Supports pastoral communities and climate resilience."
  });
  assert.equal(unverified.callStatus, "unknown");
  assert.equal(unverified.triageAssessment, "deadline_unverified_suppressed");

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

test("expired and unverified calls are suppressed from the live opportunity list", () => {
  const today = "2026-10-10";
  assert.equal(isCurrentOpportunity({ title: "Old climate grant", description: "Apply by 1 January 2020.", call_status: "open" }, today), false);
  assert.equal(isCurrentOpportunity({ title: "Stale metadata", description: "Climate resilience", call_status: "expired", deadline_at: "2099-12-31" }, today), false);
  assert.equal(isCurrentOpportunity({ title: "Closed announcement", description: "Applications are closed.", call_status: "open", deadline_at: "2099-12-31" }, today), false);
  assert.equal(isCurrentOpportunity({ title: "Unverified call", description: "Community climate support", call_status: "unknown" }, today), false);
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
  assert.equal(fit.triageAssessment, "geography_unverified_suppressed");
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

test("AI geographic gate blocks concept-note drafting when geography is ineligible or unclear", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  let modelCalls = 0;
  const env = { CRAWLER_CONTROL_TOKEN: token, AI: { run: async () => { modelCalls++; return { response: JSON.stringify({ eligibility: { status: "eligible", confidence: "high", evidence: [], unknowns: [] }, donor_requirements: [] }) }; } } };
  const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
  const southAfrica = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST", headers,
    body: JSON.stringify({ task: "concept_note", title: "South African NGO grant", description: "Only organizations registered in South Africa may apply." })
  }), env);
  assert.equal(southAfrica.status, 422);
  assert.equal((await southAfrica.json()).geographic_eligibility.status, "ineligible");

  const unknown = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST", headers,
    body: JSON.stringify({ task: "concept_note", title: "Climate grant", description: "Supports community climate adaptation." })
  }), env);
  assert.equal(unknown.status, 422);
  assert.equal((await unknown.json()).geographic_eligibility.status, "unclear");
  assert.equal(modelCalls, 0);
});

test("known IRPA eligibility gaps block concept-note drafting", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  let modelCalls = 0;
  const env = { CRAWLER_CONTROL_TOKEN: token, AI: { run: async () => {
    modelCalls++;
    return { response: JSON.stringify({ eligibility: { status: "eligible", confidence: "high", evidence: [], unknowns: [] }, donor_requirements: [] }) };
  } } };
  const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
  const cases = [
    {
      title: "East Africa civil society grant",
      description: "Open to eligible civil society organizations across East Africa.",
      donorRequirements: "Applicants must be registered in Tanzania as NGOs and must have completed at least two projects.",
      expected: "ineligible",
      expectedTerm: "no completed projects"
    },
    {
      title: "East Africa resilience grant",
      description: "Open to eligible applicants across East Africa.",
      donorRequirements: "Applicants must be registered in Tanzania as NGOs and provide 20% cash co-financing.",
      expected: "ineligible",
      expectedTerm: "cash matching/co-financing"
    },
    {
      title: "East Africa community grant",
      description: "Open to eligible applicants across East Africa.",
      donorRequirements: "Applicants must be registered in Tanzania as NGOs and the organization must have been registered for at least 5 years.",
      expected: "insufficient_information",
      expectedTerm: "5 years of organizational existence"
    },
    {
      title: "East Africa public services grant",
      description: "Open to eligible applicants across East Africa.",
      donorRequirements: "Only government agencies may apply.",
      expected: "ineligible",
      expectedTerm: "exclude registered NGOs"
    },
    {
      title: "East Africa ICCA conservation grant",
      description: "Open to eligible applicants across East Africa.",
      donorRequirements: "Applicants must be registered in Tanzania as NGOs. CSOs with over three years of proven evidence of working in or near an ICCA are eligible.",
      expected: "ineligible",
      expectedTerm: "no completed projects"
    }
  ];
  for (const item of cases) {
    const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
      method: "POST", headers,
      body: JSON.stringify({ task: "concept_note", callStatus: "open", ...item })
    }), env);
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.equal(body.eligibility_gate.status, item.expected, item.title);
    const combined = [...(body.eligibility_gate.blockers||[]), ...(body.eligibility_gate.warnings||[])].join(" ").toLowerCase();
    assert.ok(combined.includes(item.expectedTerm.toLowerCase()), "Expected eligibility evidence for: " + item.expectedTerm);
  }
  assert.equal(modelCalls, 0, "AI generation must not run when deterministic eligibility gates block drafting.");
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

test("AI concept-note gate rejects a country-focused call despite generic regional wording", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  let modelCalls = 0;
  const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({
      task: "concept_note",
      title: "Kenya climate resilience grant",
      description: "Funding is available across Africa, but this specific call is for Kenya-based organizations."
    })
  }), {
    CRAWLER_CONTROL_TOKEN: token,
    AI: { run: async () => { modelCalls++; return { response: "{}" }; } }
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).geographic_eligibility.status, "ineligible");
  assert.equal(modelCalls, 0);
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

test("registers ten independent donor scanners with official HTTPS sources", () => {
  assert.equal(DONOR_SCANNERS.length, 10);
  assert.equal(new Set(DONOR_SCANNERS.map(scanner => scanner.name)).size, 10);
  for (const scanner of DONOR_SCANNERS) {
    assert.equal(new URL(scanner.url).protocol, "https:");
    assert.ok(scanner.label.length > 3);
  }
});

test("donor scanner returns opportunities in the shared candidate shape", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    const html = url.includes("example.org/grants")
      ? '<html><head><title>Call for Proposals: Pastoral Resilience Grant</title><meta name="description" content="Funding opportunity for community rangeland restoration in Tanzania. Applications close 30 December 2026."></head><body>Funding opportunity for community rangeland restoration in Tanzania. Applications close 30 December 2026.</body></html>'
      : '<html><head><title>Call for Proposals: Pastoral Resilience Grant</title><meta name="description" content="Funding opportunity for community rangeland restoration in Tanzania. Applications close 30 December 2026."></head><body>Funding opportunity for community rangeland restoration in Tanzania. Applications close 30 December 2026.</body></html>';
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  };
  try {
    const result = await readDonorScanner({ name: "test_donor", label: "Test Donor", url: "https://example.org/grants" });
    assert.equal(result.stats.configured, 1);
    assert.ok(result.items.length >= 1);
    assert.equal(result.items[0].discoveryEngine, "test_donor");
    assert.equal(result.items[0].sourceUrl, "https://example.org/grants");
    assert.match(result.items[0].title, /Call for Proposals/);
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
  const pages = await readOfficialPages({});
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<rss><channel><item><title>Open grant for pastoral restoration</title><link>https://donor.example/call</link><description>Funding for rangeland restoration in Tanzania</description></item></channel></rss>', { status: 200, headers: { "content-type": "application/rss+xml" } });
  try {
    const search = await readWebSearch({});
    assert.equal(search.items.length, 3);
    assert.equal(search.stats.configured, true);
    assert.equal(search.stats.provider, "Google News RSS");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(pages.items.length, 0);
  assert.equal(pages.stats.configured, 0);
});
