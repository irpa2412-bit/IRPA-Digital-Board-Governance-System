import test from "node:test";
import assert from "node:assert/strict";
import { resolveExpectedIntegrity, hasIntegrityMismatch } from "../src/utils/documentIntegrity.mjs";

test("legacy envelope with no envelope or source metadata is allowed", () => {
  const expected = resolveExpectedIntegrity({}, {});
  assert.deepEqual(expected, { hash: null, size: null });
  assert.equal(hasIntegrityMismatch({ expectedHash: expected.hash, expectedSize: expected.size, actualHash: "abc", actualSize: 12 }), false);
});

test("matching envelope hash and size are accepted", () => {
  const expected = resolveExpectedIntegrity({ sha256: "AABB", byteLength: 12 }, { sha256: "source", fileSize: 99 });
  assert.deepEqual(expected, { hash: "aabb", size: 12 });
  assert.equal(hasIntegrityMismatch({ expectedHash: expected.hash, expectedSize: expected.size, actualHash: "aabb", actualSize: 12 }), false);
});

test("mismatching hash or size is blocked", () => {
  assert.equal(hasIntegrityMismatch({ expectedHash: "aabb", expectedSize: 12, actualHash: "ccdd", actualSize: 12 }), true);
  assert.equal(hasIntegrityMismatch({ expectedHash: "aabb", expectedSize: 12, actualHash: "aabb", actualSize: 13 }), true);
});

test("source document values are fallback when envelope values are absent", () => {
  const expected = resolveExpectedIntegrity({}, { sha256: "SOURCE-HASH", fileSize: 8 });
  assert.deepEqual(expected, { hash: "source-hash", size: 8 });
});

test("envelope values take precedence over source document values", () => {
  const expected = resolveExpectedIntegrity({ sha256: "ENVELOPE", byteLength: 5 }, { sha256: "SOURCE", fileSize: 8 });
  assert.deepEqual(expected, { hash: "envelope", size: 5 });
});
