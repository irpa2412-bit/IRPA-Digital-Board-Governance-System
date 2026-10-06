
import test from "node:test";
import assert from "node:assert/strict";
import { __test, INVITATION_STATES } from "../src/invitationRedemption.mjs";

test("session-state maps all invitation states", () => {
  assert.equal(__test.normalizeInvitationState(null), INVITATION_STATES.NONE);
  assert.equal(__test.normalizeInvitationState({ invitationRedeemedUid:"u1" }, "u1"), INVITATION_STATES.PASSWORD_SETUP_PENDING);
  assert.equal(__test.normalizeInvitationState({ status:"PROVISIONING_PENDING", invitationRedeemedUid:"u1" }, "u1"), INVITATION_STATES.PROVISIONING_PENDING);
  assert.equal(__test.normalizeInvitationState({ status:"ACTIVATED", invitationRedeemedUid:"u1" }, "u1"), INVITATION_STATES.ACTIVATED);
});

test("session-state never maps another user's invitation", () => {
  assert.equal(__test.normalizeInvitationState({ status:"PROVISIONING_PENDING", invitationRedeemedUid:"other" }, "u1"), INVITATION_STATES.NONE);
});

test("invitation expiry defaults to sixty minutes", () => {
  const createdAt = "2026-10-06T04:00:00.000Z";
  assert.equal(__test.invitationExpiry({ createdAt }), Date.parse(createdAt) + 60 * 60 * 1000);
});

test("explicit invitation expiry is authoritative", () => {
  const expiry = "2026-10-06T05:00:00.000Z";
  assert.equal(__test.invitationExpiry({ createdAt:"2026-10-06T04:00:00.000Z", invitationExpiresAt:expiry }), Date.parse(expiry));
});

test("failure codes never expose a secret", () => {
  const failure = __test.invitationFailure("REDEEM_TOKEN", 403, "The invitation link is invalid.");
  assert.equal(failure.error, "IRPA_INVITATION_FAILURE:REDEEM_TOKEN");
  assert.equal(JSON.stringify(failure).includes("token="), false);
});
