import test from "node:test";
import assert from "node:assert/strict";
import {
  FUNDRAISING_SOURCES, FUNDRAISING_SOURCE_REGIONS, FUNDRAISING_SOURCE_TYPES,
  isValidFundingSource, searchFundingSources, validateFundingSourceRegistry
} from "../src/pages/grant-fundraising/sourceRegistry.js";

test("curated registry has unique, valid HTTPS official routes", () => {
  assert.ok(FUNDRAISING_SOURCES.length >= 20);
  assert.deepEqual(validateFundingSourceRegistry(), []);
  for (const source of FUNDRAISING_SOURCES) {
    assert.equal(isValidFundingSource(source), true, source.id);
    assert.ok(FUNDRAISING_SOURCE_REGIONS.includes(source.region));
    assert.ok(FUNDRAISING_SOURCE_TYPES.includes(source.type));
  }
});

test("registry spans Tanzania, Africa/regional and international sources", () => {
  const regions = new Set(FUNDRAISING_SOURCES.map((source) => source.region));
  for (const region of FUNDRAISING_SOURCE_REGIONS) assert.ok(regions.has(region), region);
});

test("search is case-insensitive and matches focus and support terms", () => {
  assert.ok(searchFundingSources(FUNDRAISING_SOURCES, { query: "livestock" }).some((source) => source.id === "fao-funding"));
  assert.ok(searchFundingSources(FUNDRAISING_SOURCES, { query: "CSR" }).some((source) => source.id === "vodacom-tz"));
  assert.ok(searchFundingSources(FUNDRAISING_SOURCES, { query: "climate", region: "Africa / regional" }).length > 0);
});

test("filters apply together and empty search returns all matching source types", () => {
  const filtered = searchFundingSources(FUNDRAISING_SOURCES, { region: "Tanzania", type: "Corporate CSR / ESG" });
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every((source) => source.region === "Tanzania" && source.type === "Corporate CSR / ESG"));
  assert.equal(searchFundingSources(FUNDRAISING_SOURCES, { query: "no-such-topic" }).length, 0);
});

test("validation rejects unsafe schemes, credentials, unknown categories and duplicate ids", () => {
  const base = FUNDRAISING_SOURCES[0];
  assert.equal(isValidFundingSource({ ...base, url: "javascript:alert(1)" }), false);
  assert.equal(isValidFundingSource({ ...base, url: "https://user:pass@example.org/path" }), false);
  assert.equal(isValidFundingSource({ ...base, type: "Unapproved type" }), false);
  assert.ok(validateFundingSourceRegistry([base, { ...base, url: "https://example.org/different" }]).some((error) => error.includes("Duplicate source id")));
});
