const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore } = require("firebase-admin/firestore");
const resetDeveloperSecret = defineSecret("IRPA_RESET_DEVELOPER_SECRET");
const { validateResetAuthorization } = require("./adminRegistrationResetPolicy.cjs");
const { resetAdministratorRegistration } = require("./adminRegistrationResetService");

const db = getFirestore();

// Retired destructive collection-reset API. It is intentionally fail-closed so
// older clients cannot delete governance, finance, signature, or audit records.
function retiredResetEndpoint() {
  return onCall({ region: "us-central1", secrets: [resetDeveloperSecret] }, async () => {
    throw new HttpsError("failed-precondition", "Bulk data reset is disabled. Use resetAdministratorRegistration for the narrowly scoped recovery operation.");
  });
}
exports.requestDataReset = retiredResetEndpoint();
exports.executeDataReset = retiredResetEndpoint();
exports.cancelDataReset = retiredResetEndpoint();
exports.getDataResetStatus = retiredResetEndpoint();

exports.resetAdministratorRegistration = onCall({
  region: "us-central1",
  timeoutSeconds: 60,
  secrets: [resetDeveloperSecret],
  enforceAppCheck: true
}, async request => {
  let validated;
  try {
    validated = validateResetAuthorization({
      auth: request.auth,
      data: request.data,
      expectedSecret: resetDeveloperSecret.value()
    });
  } catch (error) {
    const allowedCodes = new Set(["unauthenticated", "permission-denied", "invalid-argument", "failed-precondition"]);
    throw new HttpsError(allowedCodes.has(error.code) ? error.code : "permission-denied", error.message || "Reset authorization was not accepted.");
  }

  try {
    return await resetAdministratorRegistration({ db, ...validated });
  } catch (error) {
    const allowedCodes = new Set(["invalid-argument", "already-exists", "failed-precondition"]);
    if (allowedCodes.has(error.code)) throw new HttpsError(error.code, error.message);
    console.error("Administrator registration reset failed", { code: error.code || "internal" });
    throw new HttpsError("internal", "Administrator recovery could not be completed. No secret material was logged.");
  }
});
