import test from "node:test";
import assert from "node:assert/strict";
import { verifyCertificatePageText, verifyCertificateInput } from "../src/recoveryCertificateVerifier.mjs";

const hash1 = "a".repeat(64);
const hash2 = "b".repeat(64);
const events = [{ type: "signer.signed", at: "2026-11-20T10:00:00.000Z", signerName: "Amina Mollel", hash: hash1 }];
const signers = [{ name: "Amina Mollel" }];
const page = `Amina Mollel 2026-11-20T10:00:00.000Z ${hash1}`;

test("matching certificate page passes", () => {
  assert.deepEqual(verifyCertificatePageText(page, events, signers), { ok: true, failures: [] });
});

test("one altered certificate value fails", () => {
  const result = verifyCertificatePageText(page.replace("Amina Mollel", "Altered Name"), events, signers);
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("CERTIFICATE_SIGNER_MISSING"));
});

test("one extra timestamp and hash fail", () => {
  const result = verifyCertificatePageText(page + " 2026-11-21T10:00:00.000Z " + hash2, events, signers);
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("CERTIFICATE_TIMESTAMP_EXTRA"));
  assert.ok(result.failures.includes("CERTIFICATE_EVENT_HASH_EXTRA"));
});

test("builder input must exactly carry the verified chain values", () => {
  const info = { signers: [{ name: "Amina Mollel" }], events, completedAt: "NOT RECORDED", chainHead: hash1 };
  assert.equal(verifyCertificateInput(info, events, signers).ok, true);
  assert.equal(verifyCertificateInput({ ...info, signers: [{ name: "Altered" }] }, events, signers).ok, false);
});
