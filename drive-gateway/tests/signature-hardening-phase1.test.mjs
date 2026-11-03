import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("Gateway envelope creation rejects duplicate UIDs and duplicate emails and validates signing mode", async () => {
  const source = await read("../src/signing.mjs");
  assert.match(source, /if\(!\["Sequential","Parallel"\]\.includes\(signingMode\)\)/);
  assert.match(source, /if\(seenEmails\.has\(email\.toLowerCase\(\)\)\)/);
  assert.match(source, /if\(uid&&seenUids\.has\(uid\)\)throw new HttpError\(400,"Duplicate signer UID\."/);
  assert.match(source, /meta\.create\("externalReferences",reservationKey/);
});

test("Completed Gateway envelopes are immutable to the void operation", async () => {
  const source = await read("../src/signing.mjs");
  assert.match(source, /if\(e\.status==="Completed"\)throw new HttpError\(409,"A completed envelope cannot be voided\."/);
  assert.match(source, /if\(c\.status==="Completed"\)throw new HttpError\(409,"A completed envelope cannot be voided\."/);
});

test("signer status limits UID disclosure to the caller, owner or administrator", async () => {
  const source = await read("../src/signing.mjs");
  assert.match(source, /user\.uid===env\.createdBy\|\|user\.isAdmin===true/);
  assert.match(source, /privileged\|\|s\.id===signer\.id\?\(s\.uid\|\|null\):null/);
});

test("authority matching is fail-closed and binds email matches to authenticated UID", async () => {
  const source = await read("../src/index.js");
  assert.match(source, /status!=="active"/);
  assert.match(source, /record\\.authorityStatus!==undefined/);
  assert.match(source, /record\\.matchedByEmail/);
  assert.match(source, /authorityExpiresAt\\|\\|record\\.authorityExpiry/);
});

test("draft save validates source ownership, signer uniqueness and signing mode", async () => {
  const source = await read("../src/index.js");
  assert.match(source, /sourceOwnerUid !== uid/);
  assert.match(source, /Only the source-document owner or an authorized administrator/);
  assert.match(source, /Signing mode must be Sequential or Parallel/);
  assert.match(source, /Duplicate signer UID is not permitted/);
  assert.match(source, /Duplicate signer email is not permitted/);
});

test("lifecycle completion requires canonical Gateway quorum, PDF hash and cryptographic evidence", async () => {
  const index = await read("../src/index.js");
  const lifecycle = await read("../src/documentLifecycle.mjs");
  assert.match(index, /envelope\.status!=="Completed"/);
  assert.match(index, /signers\.some\(s=>s\.status!=="Signed"\|\|!s\.uid\|\|!s\.signedAt\)/);
  assert.match(index, /finalHash!==envelope\.completion\.finalHash/);
  assert.match(index, /verifyCryptographicEvidence\(evidence/);
  assert.match(lifecycle, /deps\.verifyCanonicalSignatureEnvelope\(env,envelopeId\)/);
  assert.match(lifecycle, /signedByUid:lastSignedByUid/);
  assert.doesNotMatch(lifecycle, /signedByUid:envelope\.lastSignedByUid\|\|claims\.user_id/);
});

test("completion failure is surfaced and mirror preserves canonical Worker status", async () => {
  const storage = await read("../../src/firebase/signatureStorage.js");
  const platform = await read("../../src/firebase/signaturePlatform.js");
  assert.match(storage, /data\.status === "CompletionFailed"/);
  assert.match(platform, /const overall=String\(gatewayStatus\.status\|\|"Unknown"\)/);
});

test("mirror retry records a bounded exponential retry deadline", async () => {
  const source = await read("../src/signing.mjs");
  assert.match(source, /mirrorNextRetryAt/);
  assert.match(source, /Math\.min\(60\*60\*1000,30\*1000\*Math\.pow\(2/);
});
