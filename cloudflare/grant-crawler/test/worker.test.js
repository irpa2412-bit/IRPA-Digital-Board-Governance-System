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
