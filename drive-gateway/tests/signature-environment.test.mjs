import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSignatureEnvironment } from "../src/signatureEnvironment.mjs";

test("normalizes TRIAL and ACTUAL environment markers consistently", () => {
  assert.equal(normalizeSignatureEnvironment({recordOrigin:"TRIAL"}).environment,"TRIAL");
  assert.equal(normalizeSignatureEnvironment({dataEnvironment:"ACTUAL"}).environment,"ACTUAL");
  assert.equal(normalizeSignatureEnvironment({recordOrigin:"PRODUCTION"}).environment,"ACTUAL");
});

test("uses trialData and isTrial when string environment markers are absent", () => {
  assert.equal(normalizeSignatureEnvironment({trialData:true}).environment,"TRIAL");
  assert.equal(normalizeSignatureEnvironment({isTrial:false}).environment,"ACTUAL");
});

test("conflicting and missing markers fail closed to UNKNOWN", () => {
  assert.equal(normalizeSignatureEnvironment({recordOrigin:"TRIAL",dataEnvironment:"ACTUAL"}).environment,"UNKNOWN");
  assert.equal(normalizeSignatureEnvironment({}).environment,"UNKNOWN");
  assert.equal(normalizeSignatureEnvironment({recordOrigin:"DEVELOPMENT"}).environment,"UNKNOWN");
});
