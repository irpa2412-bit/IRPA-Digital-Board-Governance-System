import test from "node:test";
import assert from "node:assert/strict";
import worker, { assessFit, parseFeed, safeUrl } from "../src/index.js";

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

test("health endpoint reports Firebase disabled and does not expose secrets", async () => {
  const response = await worker.fetch(new Request("https://crawler.example/health"), {
    IRPA_ENVIRONMENT: "staging",
    CRAWLER_CONTROL_TOKEN: "never-echo-this-token",
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.firebase, "disabled-by-design-until-dedicated-rules-and-identity-are-approved");
  assert.equal(JSON.stringify(body).includes("never-echo-this-token"), false);
});

test("crawl endpoint rejects unauthenticated requests", async () => {
  const response = await worker.fetch(new Request("https://crawler.example/crawl", { method: "POST" }), {});
  assert.equal(response.status, 401);
});


test("IRPA fit matcher prioritizes pastoral and rangeland calls without claiming legal eligibility", () => {
  const fit = assessFit({
    title: "Community-led rangeland restoration and drought resilience",
    description: "Supporting pastoralist livelihoods, women and youth groups in Tanzania.",
  });
  assert.equal(fit.fitAssessment, "strong_topic_match");
  assert.ok(fit.score >= 35);
  assert.ok(fit.reasons.includes("pastoralism/rangelands"));
  assert.equal(fit.eligibilityStatus, "unverified");
});

test("generic unrelated call is low topic match and eligibility remains unverified", () => {
  const fit = assessFit({ title: "University arts fellowship", description: "Performing arts scholarship." });
  assert.equal(fit.fitAssessment, "low_topic_match");
  assert.equal(fit.eligibilityStatus, "unverified");
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


test("AI grant assistant is authenticated and returns structured eligibility analysis", async () => {
  const token = "test-token-with-at-least-32-characters-long";
  let usedModel = "";
  const mockAnalysis = {
    summary: "Potential fit; verify the official guidelines.",
    eligibility: { status: "possibly_eligible", confidence: "medium", evidence: ["Tanzania is in the stated geography"], unknowns: ["Minimum organizational age"] },
    strategic_alignment: { relevant_pillars: ["Sustainable Rangeland Management"], relevant_cross_cutting_themes: ["gender equality and social inclusion"], digital_governance_relevance: "low", rationale: "Based on supplied call text", funding_use_fit: [] },
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
      return { response: JSON.stringify(mockAnalysis) };
    } }
  };
  const denied = await worker.fetch(new Request("https://crawler.example/assistant/analyze", { method: "POST", body: JSON.stringify({ title: "Test grant", description: "Tanzania climate resilience" }) }), env);
  assert.equal(denied.status, 401);

  const response = await worker.fetch(new Request("https://crawler.example/assistant/analyze", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ title: "Rangeland grant", description: "Tanzania pastoral resilience", donorRequirements: "Applicants must be registered NGOs", url: "https://donor.example/call" })
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


test("digital governance and DBGS investment opportunities are retained as a distinct strategic track", () => {
  const fit = assessFit({
    title: "Digital governance and board management system investment fund",
    description: "Support for nonprofit board governance technology, cybersecurity and cloud infrastructure for civil society organizations."
  });
  assert.equal(fit.digitalGovernanceMatch, true);
  assert.equal(fit.strategicTrack, "digital_governance_DBGS_investment");
  assert.ok(fit.reasons.includes("digital governance/DBGS investment"));
  assert.equal(fit.eligibilityStatus, "unverified");
});


test("market development and governance capacity are explicit IRPA fit signals", () => {
  const fit = assessFit({
    title: "Institutional strengthening and livestock market access",
    description: "Support for value addition, market linkages, accountability and transparent governance for community organizations."
  });
  assert.ok(fit.reasons.includes("market development/value addition"));
  assert.ok(fit.reasons.includes("governance/institutional capacity"));
});
