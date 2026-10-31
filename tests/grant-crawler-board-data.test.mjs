import test from "node:test";
import assert from "node:assert/strict";
import { mapCrawlerOpportunity, mergeCrawlerOpportunityPage, summarizeCrawlerSources } from "../src/pages/grant-crawler-board-data.js";

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
