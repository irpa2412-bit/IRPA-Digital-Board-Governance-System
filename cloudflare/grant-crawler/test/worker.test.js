import test from "node:test";
import assert from "node:assert/strict";
import worker, { assessFit, parseFeed, safeUrl } from "../src/index.js";
import { assessGeographicEligibility } from "../src/assistant.js";

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
    description: "Open to civil society organizations across East Africa."
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
      body: JSON.stringify({ task: "concept_note", ...item })
    }), env);
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.equal(body.eligibility_gate.status, item.expected);
    const combined = [...(body.eligibility_gate.blockers||[]), ...(body.eligibility_gate.warnings||[])].join(" ").toLowerCase();
    assert.ok(combined.includes(item.expectedTerm.toLowerCase()), "Expected eligibility evidence for: " + item.expectedTerm);
  }
  assert.equal(modelCalls, 0, "AI generation must not run when deterministic eligibility gates block drafting.");
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
      return { response: JSON.stringify(mockAnalysis) };
    } }
  };
  const denied = await worker.fetch(new Request("https://crawler.example/assistant/analyze", { method: "POST", body: JSON.stringify({ title: "Test grant", description: "Tanzania climate resilience" }) }), env);
  assert.equal(denied.status, 401);

  const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ title: "Rangeland grant", description: "Pastoral resilience", donorRequirements: "Applicants must be registered in Tanzania as NGOs", url: "https://donor.example/call" })
  }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.service, "irpa-grant-application-assistant");
  assert.equal(body.assessment.eligibility.status, "possibly_eligible");
  assert.equal(body.assessment.donor_requirements.length, 1);
  assert.equal(usedModel, "@cf/meta/llama-3.1-8b-instruct");
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
