const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { validateResetAuthorization, RESET_CONFIRMATION } = require("./adminRegistrationResetPolicy.cjs");

const secret = crypto.randomBytes(32).toString("hex");
const now = 1_800_000_000;
const valid = () => ({
  auth: { uid: "designated-recovery-operator", token: { email: "irpa2412@gmail.com", auth_time: now - 5 } },
  data: { developerSecret: secret, targetUid: "target-admin-uid", operationId: "123e4567-e89b-42d3-a456-426614174000", confirmation: RESET_CONFIRMATION, reason: "Recover the designated administrator registration after verified lockout." },
  expectedSecret: secret,
  nowSeconds: now
});

test("accepts only designated operator with fresh authentication and correct secret", () => {
  const result = validateResetAuthorization(valid());
  assert.equal(result.actor.email, "irpa2412@gmail.com");
  assert.equal(result.targetUid, "target-admin-uid");
});

test("rejects incorrect secret without revealing secret material", () => {
  const input = valid();
  input.data.developerSecret = crypto.randomBytes(32).toString("hex");
  assert.throws(() => validateResetAuthorization(input), e => e.code === "permission-denied" && !e.message.includes(secret));
});

test("rejects unauthenticated and non-designated operators", () => {
  const unauth = valid(); unauth.auth = null;
  assert.throws(() => validateResetAuthorization(unauth), e => e.code === "unauthenticated");
  const other = valid(); other.auth.token.email = "someone@example.org";
  assert.throws(() => validateResetAuthorization(other), e => e.code === "permission-denied");
});

test("rejects stale authentication, self-reset, and missing explicit confirmation", () => {
  const stale = valid(); stale.auth.token.auth_time = now - 601;
  assert.throws(() => validateResetAuthorization(stale), e => e.message.includes("Recent re-authentication"));
  const self = valid(); self.data.targetUid = self.auth.uid;
  assert.throws(() => validateResetAuthorization(self), e => e.code === "failed-precondition");
  const noConfirm = valid(); noConfirm.data.confirmation = "yes";
  assert.throws(() => validateResetAuthorization(noConfirm), e => e.code === "failed-precondition");
});

test("requires valid operation ID and a meaningful reason", () => {
  const badId = valid(); badId.data.operationId = "reuse-me";
  assert.throws(() => validateResetAuthorization(badId), e => e.code === "invalid-argument");
  const badReason = valid(); badReason.data.reason = "reset";
  assert.throws(() => validateResetAuthorization(badReason), e => e.code === "invalid-argument");
});
