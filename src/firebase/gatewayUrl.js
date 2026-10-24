const configuredGatewayUrl = String(import.meta.env.VITE_GOOGLE_DRIVE_GATEWAY_URL || "").trim();

if (__IRPA_STAGING_BUILD__ && !configuredGatewayUrl) {
  throw new Error("Staging builds require VITE_GOOGLE_DRIVE_GATEWAY_URL; production gateway fallback is forbidden.");
}

export function getGoogleDriveGatewayUrl() {
  return configuredGatewayUrl || __IRPA_DEFAULT_GATEWAY_URL__;
}

// Preserve the established Trial/Test route in production builds. A staging build
// uses its single configured gateway for both data modes and cannot target production.
export function getTrialGoogleDriveGatewayUrl() {
  return __IRPA_STAGING_BUILD__
    ? getGoogleDriveGatewayUrl()
    : "https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev";
}
