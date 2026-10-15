const crypto = require("node:crypto");

const RECOVERY_OPERATOR_EMAIL = "irpa2412@gmail.com";
const RESET_CONFIRMATION = "RESET ADMIN REGISTRATION ONLY";
const MAX_AUTH_AGE_SECONDS = 10 * 60;

function fail(message, code = "permission-denied") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validateResetAuthorization({ auth, data, expectedSecret, nowSeconds = Math.floor(Date.now() / 1000) }) {
  const uid = String(auth?.uid || "").trim();
  const email = String(auth?.token?.email || "").trim().toLowerCase();
  if (!uid) fail("Authenticated recovery operator is required.", "unauthenticated");
  if (email !== RECOVERY_OPERATOR_EMAIL) fail("This account is not the designated recovery operator.");

  const authTime = Number(auth?.token?.auth_time);
  if (!Number.isFinite(authTime) || authTime > nowSeconds + 30 || nowSeconds - authTime > MAX_AUTH_AGE_SECONDS) {
    fail("Recent re-authentication is required before administrator recovery.");
  }

  const expected = String(expectedSecret || "");
  const supplied = String(data?.developerSecret || "");
  const isHexSecret = value => /^[a-fA-F0-9]{64}$/.test(value);
  if (!isHexSecret(expected) || !isHexSecret(supplied)) fail("Reset authorization was not accepted.");
  const expectedBytes = Buffer.from(expected, "hex");
  const suppliedBytes = Buffer.from(supplied, "hex");
  if (expectedBytes.length !== suppliedBytes.length || !crypto.timingSafeEqual(expectedBytes, suppliedBytes)) {
    fail("Reset authorization was not accepted.");
  }

  const targetUid = String(data?.targetUid || "").trim();
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(targetUid)) fail("A valid target administrator UID is required.", "invalid-argument");
  if (targetUid === uid) fail("The recovery operator cannot reset their own administrator profile.", "failed-precondition");
  if (String(data?.confirmation || "") !== RESET_CONFIRMATION) fail("Explicit reset confirmation did not match.", "failed-precondition");

  const operationId = String(data?.operationId || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId)) {
    fail("A unique version-4 operation ID is required.", "invalid-argument");
  }
  const reason = String(data?.reason || "").trim();
  if (reason.length < 20 || reason.length > 500) fail("Provide a reset reason between 20 and 500 characters.", "invalid-argument");

  return { actor: { uid, email }, targetUid, operationId, reason };
}

module.exports = { RECOVERY_OPERATOR_EMAIL, RESET_CONFIRMATION, validateResetAuthorization };
