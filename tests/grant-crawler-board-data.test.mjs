import test from "node:test";
import assert from "node:assert/strict";
import { cleanCrawlerText, mapCrawlerOpportunity, mergeCrawlerOpportunityPage, summarizeCrawlerSources } from "../src/pages/grant-crawler-board-data.js";

test("crawler records map the API snake_case fields into board fields without requiring verification metadata", () => {
  const record = mapCrawlerOpportunity({
    id: "abc", title: "Pastoral livelihoods", url: "https://donor.example/call",
    source_url: "https://donor.example", call_status: "unknown",
    geography_assessment: "regional_or_lmic_scope", pillars: '["rangeland"]',
    themes: ["youth"], fit_score: 42
  });
  assert.equal(record.id, "crawler-abc");
  assert.equal(record.title, "Pastoral livelihoods");
  assert.equal(record.status, "Under review");
  assert.equal(record.country, "Regional / LMIC");
  assert.deepEqual(record.pillars, ["rangeland"]);
  assert.deepEqual(record.themes, ["youth"]);
  assert.equal(record.sourceType, "Cloudflare crawler");
});

test("first page replaces stale records and later pages append while deduplicating IDs", () => {
  const first = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(mergeCrawlerOpportunityPage([{ id: "old" }], first, 0), first);
  assert.deepEqual(mergeCrawlerOpportunityPage(first, [{ id: "b", title: "updated" }, { id: "c" }], 2), [
    { id: "a" }, { id: "b", title: "updated" }, { id: "c" }
  ]);
});

test("crawler source summary reads engineRuns and crawl-run engines instead of absent sourceCount fields", () => {
  assert.deepEqual(summarizeCrawlerSources({ engineRuns: [{ status: "success" }, { status: "partial" }, { status: "failed" }] }), { checked: 3, healthy: 2, failed: 1 });
  assert.deepEqual(summarizeCrawlerSources({ engines: [{ stats: { status: "success" } }, { stats: { status: "failed" } }] }), { checked: 2, healthy: 1, failed: 1 });
  assert.deepEqual(summarizeCrawlerSources({}), { checked: 0, healthy: 0, failed: 0 });
});

test("crawler display text strips HTML, decodes entities, removes navigation boilerplate and caps descriptions",()=>{
 assert.equal(cleanCrawlerText('<a href="https://news.google.com/rss/articles/x">Tanzania &amp; East Africa funding</a>',180),"Tanzania & East Africa funding");
 assert.equal(cleanCrawlerText('<p>Skip to main content</p><nav>Home Menu About Us Contact Us</nav><p>Official donor call&nbsp;for pastoral communities &mdash; details &quot;verified&quot;.</p>'),'Official donor call for pastoral communities — details "verified".');
 assert.equal(cleanCrawlerText("x".repeat(400),280).length,280);
 assert.equal(cleanCrawlerText("<script>alert(1)</script><style>.x{}</style>Useful <strong>funding</strong> text"),"Useful funding text");
});
test("crawler mapping sanitizes source-provided card titles and descriptions",()=>{
 const record=mapCrawlerOpportunity({id:"html",title:'<a href="https://news.google.com/rss/articles/x">Pastoral grants &amp; livestock</a>',description:'<div>Skip to main content</div><nav>Home Menu</nav><p>Official call for Tanzania pastoral groups.</p>'});
 assert.equal(record.title,"Pastoral grants & livestock");
 assert.equal(record.summary,"Official call for Tanzania pastoral groups.");
});
