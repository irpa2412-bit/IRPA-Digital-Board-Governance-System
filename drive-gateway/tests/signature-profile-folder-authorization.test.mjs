import assert from "node:assert/strict";
import test from "node:test";
import { canProvisionSignatureProfileFolder } from "../src/signatureProfileAuthorization.mjs";

test("an authenticated member or employee may provision only their own Signature Profile folder", () => {
  assert.equal(canProvisionSignatureProfileFolder({
    authenticatedUid: "member-001",
    requestedUid: "member-001",
    isAdmin: false,
  }), true);
  assert.equal(canProvisionSignatureProfileFolder({
    authenticatedUid: "member-001",
    requestedUid: "member-002",
    isAdmin: false,
  }), false);
});

test("an active administrator may provision another profile's folder", () => {
  assert.equal(canProvisionSignatureProfileFolder({
    authenticatedUid: "admin-001",
    requestedUid: "member-002",
    isAdmin: true,
  }), true);
});

test("missing actor or target fails closed", () => {
  assert.equal(canProvisionSignatureProfileFolder({ requestedUid: "member-001" }), false);
  assert.equal(canProvisionSignatureProfileFolder({ authenticatedUid: "member-001" }), false);
  assert.equal(canProvisionSignatureProfileFolder({
    authenticatedUid: "member-001",
    requestedUid: "member-002",
    isAdmin: "true",
  }), false);
});
