const { onCall, HttpsError } = require("firebase-functions/v2/https");

// All legacy bulk-reset and administrator-reset callables remain retired and
// fail closed. The narrowly scoped administrator registration recovery endpoint
// is implemented by the Cloudflare Worker, not Firebase Cloud Functions.
function retiredResetEndpoint() {
  return onCall({ region: "us-central1" }, async () => {
    throw new HttpsError(
      "failed-precondition",
      "Administrator recovery is not available through Firebase Functions. Use the controlled Cloudflare Worker endpoint."
    );
  });
}

exports.requestDataReset = retiredResetEndpoint();
exports.executeDataReset = retiredResetEndpoint();
exports.cancelDataReset = retiredResetEndpoint();
exports.getDataResetStatus = retiredResetEndpoint();
