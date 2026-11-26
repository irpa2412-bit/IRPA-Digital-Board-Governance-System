import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const start = source.indexOf("async function getSignatureWorkflowListRoute");
const end = source.indexOf("async function getSignatureWorkflowViewRoute", start);
const route = source.slice(start, end);

test("workflow listing uses server-side owner, sender and participant queries", () => {
  assert.match(route, /queryField\(collectionId,"ownerUid","EQUAL"/);
  assert.match(route, /queryField\(collectionId,"senderUid","EQUAL"/);
  assert.match(route, /queryField\(collectionId,"participantUids","ARRAY_CONTAINS"/);
  assert.match(route, /\["envelopes","signatureEnvelopes"\]/);
});

test("workflow listing uses cursor pagination and bounded pages", () => {
  assert.match(route, /orderBy:\[\{field:\{fieldPath:"__name__"\},direction:"ASCENDING"\}\]/);
  assert.match(route, /startAt=|structuredQuery\.startAt/);
  assert.match(route, /limit:100/);
  assert.doesNotMatch(route, /documents\/signatureEnvelopes\?pageSize|listCollection\(/);
});

test("only the three elevated roles can list across owners", () => {
  assert.match(route, /new Set\(\["administrator","executive director","director of internal oversight"\]\)/);
  assert.match(route, /canListAcrossOwners/);
});

test("every fetched record is checked through the visibility policy", () => {
  assert.match(route, /filterSignatureEnvelopeForCaller\(envelope/);
  assert.match(route, /if\(filtered\.allowed\) envelopes\.push/);
});

test("workflow listing normalizes PRODUCTION to ACTUAL and labels missing metadata UNKNOWN", () => {
  assert.match(route, /normalizeSignatureEnvironment\(envelope\)/);
  assert.match(route, /normalizeSignatureEnvironment\(\{recordOrigin:rawEnvironment\}\)/);
  assert.match(route, /normalizedEnvironment:normalizedEnvironment\.environment/);
  assert.match(route, /INVALID_ENVIRONMENT_FILTER/);
});
