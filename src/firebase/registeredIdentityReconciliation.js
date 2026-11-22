import { auth } from "./config";
import { getGoogleDriveGatewayUrl } from "./gatewayUrl";

export async function reconcileRegisteredIdentityUidsViaGateway() {
  const user = auth.currentUser;
  if (!user) throw new Error("Step Firebase authentication failed: sign in again.");
  const gateway = getGoogleDriveGatewayUrl();
  if (!gateway) throw new Error("Step gateway configuration failed: VITE_GOOGLE_DRIVE_GATEWAY_URL is missing.");
  let response;
  try {
    response = await fetch(gateway + "/api/members/reconcile-registered-identity-uids", {
      method: "POST",
      headers: { Authorization: "Bearer " + await user.getIdToken(), "Content-Type": "application/json" },
      body: "{}"
    });
  } catch (error) {
    throw new Error("Step Worker request failed: " + String(error?.message || error));
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) {
    throw new Error("Step " + (result.step || "Worker response") + " failed: " + (result.error || ("HTTP " + response.status)));
  }
  return result;
}
