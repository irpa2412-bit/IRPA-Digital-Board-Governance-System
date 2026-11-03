import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isCurrentSigningAuthorityRecord } from "../src/signingAuthorityPolicy.mjs";
import { signatureDraftOwnershipAllowed, validateSignatureDraftRecipients } from "../src/signatureDraftPolicy.mjs";

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

test("signing authority accepts only Active, current, unexpired UID-bound register records", () => {
  assert.equal(isCurrentSigningAuthorityRecord({status:"Active",uid:"u1",authorityStatus:"Current",authorityExpiresAt:"2027-01-01T00:00:00Z"}, "u1", Date.parse("2026-11-03T00:00:00Z")), true);
  for (const status of ["Suspended","Terminated","Disabled","Expired","Unknown","Inactive"]) {
    assert.equal(isCurrentSigningAuthorityRecord({status,uid:"u1"}, "u1"), false, status+" must fail closed");
  }
  assert.equal(isCurrentSigningAuthorityRecord({status:"Active",uid:"u1",authorityStatus:"Expired"}, "u1"), false);
  assert.equal(isCurrentSigningAuthorityRecord({status:"Active",uid:"u2",matchedByEmail:true}, "u1"), false);
  assert.equal(isCurrentSigningAuthorityRecord({status:"Active",uid:"u1",matchedByEmail:true}, "u1"), true);
  assert.equal(isCurrentSigningAuthorityRecord({status:"Active",uid:"u1",authorityExpiresAt:"2026-01-01T00:00:00Z"}, "u1", Date.parse("2026-11-03T00:00:00Z")), false);
  assert.equal(isCurrentSigningAuthorityRecord({status:"Active",uid:"u1",authorityExpiresAt:"not-a-date"}, "u1"), false);
});

test("signature draft ownership and recipient policy have positive and negative cases", () => {
  assert.equal(signatureDraftOwnershipAllowed({ownerUid:"u1"},"u1",false), true);
  assert.equal(signatureDraftOwnershipAllowed({ownerUid:"u2"},"u1",true), true);
  assert.equal(signatureDraftOwnershipAllowed({ownerUid:"u2"},"u1",false), false);
  assert.equal(validateSignatureDraftRecipients([{uid:"u1",email:"one@example.org"},{uid:"u2",email:"two@example.org"}],"Sequential"), null);
  assert.match(validateSignatureDraftRecipients([{uid:"u1",email:"one@example.org"},{uid:"u1",email:"two@example.org"}],"Sequential"), /Duplicate signer UID/);
  assert.match(validateSignatureDraftRecipients([{uid:"u1",email:"one@example.org"},{uid:"u2",email:"ONE@example.org"}],"Sequential"), /Duplicate signer email/);
  assert.match(validateSignatureDraftRecipients([{uid:"u1",email:"one@example.org"}],"Invalid"), /Signing mode/);
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
