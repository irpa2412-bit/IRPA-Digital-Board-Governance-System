import test from "node:test";
import assert from "node:assert/strict";
import {
  SELF_TEST_DOCUMENT_TIMEOUT_MS,
  SELF_TEST_TOTAL_TIMEOUT_MS,
  SELF_TEST_RUN_LIMIT,
  safeGatewayText,
  takeSelfTestBatch,
  validateSelfTestGatewayResponse
} from "../src/utils/signatureSelfTestSafety.mjs";

test("500 mocked documents are processed in sequential batches of no more than 20", () => {
  const documents = Array.from({ length: 500 }, (_, index) => ({ documentId: "mock-" + index }));
  const seen = [];
  for (let offset = 0; offset < documents.length; offset += SELF_TEST_RUN_LIMIT) {
    const batch = takeSelfTestBatch(documents, offset);
    assert.ok(batch.length <= 20);
    seen.push(...batch);
  }
  assert.equal(seen.length, 500);
  assert.deepEqual(seen.map(item => item.documentId), documents.map(item => item.documentId));
});

test("Gateway response validation rejects null, arrays and missing reconcile result", () => {
  assert.throws(() => validateSelfTestGatewayResponse(null), /invalid response/);
  assert.throws(() => validateSelfTestGatewayResponse([]), /invalid response/);
  assert.throws(() => validateSelfTestGatewayResponse({ ok: true, results: [] }, { kind: "reconcile" }), /no valid result/);
  assert.throws(() => validateSelfTestGatewayResponse({ ok: true, results: [null] }, { kind: "reconcile" }), /no valid result/);
});

test("Gateway response validation classifies 403 and timeout responses", () => {
  assert.throws(() => validateSelfTestGatewayResponse({ error: "denied" }, { httpStatus: 403 }), error => error.httpStatus === 403);
  assert.throws(() => validateSelfTestGatewayResponse({ error: "timeout" }, { httpStatus: 408 }), error => error.httpStatus === 408);
});

test("Gateway diagnostic text is bounded and sanitised", () => {
  const value = safeGatewayText("bad\u0000" + "x".repeat(900));
  assert.equal(value.length, 500);
  assert.doesNotMatch(value, /\u0000/);
});

test("self-test time limits remain bounded", () => {
  assert.equal(SELF_TEST_DOCUMENT_TIMEOUT_MS, 15000);
  assert.equal(SELF_TEST_TOTAL_TIMEOUT_MS, 60000);
});
