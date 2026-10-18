const STAGING_PROJECT = "irpa-dbg-staging-a73ec";
const PRODUCTION_PROJECT = "irpa-digital-board-governance";
const STAGING_GATEWAY = "https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev";
const PRODUCTION_GATEWAY = "https://irpa-google-drive-gateway.irpa-governance.workers.dev";

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\\/+$/, "");
}

/**
 * Resolve the one permitted Cloudflare Gateway for this build.
 * The Firebase project is the environment authority; explicit URL overrides
 * are accepted only when every supplied value agrees with that environment.
 */
export function resolveGatewayUrl(env = import.meta.env) {
  const projectId = String(env.VITE_FIREBASE_PROJECT_ID || PRODUCTION_PROJECT).trim();
  let expected;
  if (projectId === STAGING_PROJECT) expected = STAGING_GATEWAY;
  else if (projectId === PRODUCTION_PROJECT) expected = PRODUCTION_GATEWAY;
  else throw new Error(`Unrecognized Firebase project "${projectId}". Gateway access is blocked.`);

  const declaredEnvironment = String(env.VITE_IRPA_DEPLOYMENT_ENV || "").trim().toLowerCase();
  const expectedEnvironment = projectId === STAGING_PROJECT ? "staging" : "production";
  if (declaredEnvironment && declaredEnvironment !== expectedEnvironment) {
    throw new Error(`Deployment environment "${declaredEnvironment}" conflicts with Firebase project "${projectId}". Gateway access is blocked.`);
  }

  const explicitUrls = [
    ["VITE_GATEWAY_ORIGIN", env.VITE_GATEWAY_ORIGIN],
    ["VITE_GOOGLE_DRIVE_GATEWAY_URL", env.VITE_GOOGLE_DRIVE_GATEWAY_URL],
    ["VITE_GOOGLE_DRIVE_GATEWAY_STAGING_URL", env.VITE_GOOGLE_DRIVE_GATEWAY_STAGING_URL],
    ["VITE_META_STAGING_GATEWAY_URL", env.VITE_META_STAGING_GATEWAY_URL]
  ].filter(([, value]) => String(value || "").trim());

  for (const [name, value] of explicitUrls) {
    if (normalizeUrl(value) !== expected) {
      throw new Error(`${name} conflicts with Firebase project "${projectId}". Expected ${expected}; received ${normalizeUrl(value)}. Gateway access is blocked.`);
    }
  }
  return expected;
}
