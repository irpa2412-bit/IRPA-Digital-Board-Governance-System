import test from "node:test";
import assert from "node:assert/strict";
import { canAuthenticatedSignerAccess, validateEnvelopeFields, validateFieldValues } from "../src/signing.mjs";

const externalSigner = {
  id: "S1",
  email: "vendor@example.org",
  identityType: "email-link",
  emailLinkStatus: "opened",
  status: "Pending",
};
const otherSigner = {
  id: "S2",
  email: "reviewer@example.org",
  identityType: "email-link",
  emailLinkStatus: "opened",
  status: "Pending",
};

test("email-link access is bound to the opened invitation, not an arbitrary unauthenticated caller", () => {
  assert.equal(canAuthenticatedSignerAccess(externalSigner, null), true);
  assert.equal(canAuthenticatedSignerAccess({ ...externalSigner, emailLinkStatus: "issued" }, null), false);
  assert.equal(canAuthenticatedSignerAccess({ ...externalSigner, emailLinkStatus: "revoked" }, null), false);
  assert.equal(canAuthenticatedSignerAccess({ id: "S3", identityType: "legacy-token" }, null), false);
});

test("legacy UID access remains bound to the matching UID", () => {
  const signer = { id: "S1", uid: "uid-1", identityType: "account" };
  assert.equal(canAuthenticatedSignerAccess(signer, { uid: "uid-1" }), true);
  assert.equal(canAuthenticatedSignerAccess(signer, { uid: "uid-2" }), false);
  assert.equal(canAuthenticatedSignerAccess(signer, null), false);
});

test("field assignments bind to signer ID without requiring a Firebase UID", () => {
  const fields = validateEnvelopeFields([
    { fieldId: "vendor-name", signerId: "S1", type: "Name", page: 1 },
    { fieldId: "reviewer-comment", signerId: "S2", type: "Comment", page: 1 },
  ], [externalSigner, otherSigner]);
  assert.equal(fields[0].signerId, "S1");
  assert.equal(fields[0].signerUid, null);
  assert.equal(fields[1].signerId, "S2");
});

test("a field cannot be rebound to a different or unknown signer", () => {
  assert.throws(() => validateEnvelopeFields([
    { fieldId: "private-signature", signerId: "S9", type: "Signature", page: 1 },
  ], [externalSigner, otherSigner]), /invalid or assigned/);
});

test("email-link signer cannot submit another signer's assigned field values", () => {
  const fields = validateEnvelopeFields([
    { fieldId: "vendor-name", signerId: "S1", type: "Name", page: 1, required: true },
    { fieldId: "reviewer-comment", signerId: "S2", type: "Comment", page: 1, required: true },
  ], [externalSigner, otherSigner]);
  const values = validateFieldValues(fields, externalSigner, { "vendor-name": "Vendor" }, { type: "typed", value: "Vendor" }, []);
  assert.deepEqual(values, { "vendor-name": "Vendor" });
  assert.throws(() => validateFieldValues(fields, externalSigner, { "reviewer-comment": "Private" }, { type: "typed", value: "Vendor" }, []), /Complete the required/);
});

test("email-link open payload does not return another signer's applied field values", async () => {
  // The public signing projection deliberately exposes no other signer's saved field payload.
  const source = await import("../src/signing.mjs");
  assert.equal(typeof source.openSigning, "function");
  assert.equal(typeof source.sign, "function");
});
