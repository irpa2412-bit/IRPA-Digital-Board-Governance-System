const configuredGatewayUrl = String(import.meta.env.VITE_GOOGLE_DRIVE_GATEWAY_URL || "").trim();

if (__IRPA_STAGING_BUILD__ && !configuredGatewayUrl) {
  throw new Error("Staging builds require VITE_GOOGLE_DRIVE_GATEWAY_URL; production gateway fallback is forbidden.");
}

export function getGoogleDriveGatewayUrl() {
  return configuredGatewayUrl || __IRPA_DEFAULT_GATEWAY_URL__;
}
