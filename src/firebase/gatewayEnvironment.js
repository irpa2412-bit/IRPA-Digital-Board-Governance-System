export const FIREBASE_ENVIRONMENTS = Object.freeze({
  staging: Object.freeze({
    name: "staging",
    projectId: "irpa-dbg-staging-a73ec",
    authDomain: "irpa-dbg-staging-a73ec.firebaseapp.com",
    gateway: "https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev"
  }),
  production: Object.freeze({
    name: "production",
    projectId: "irpa-digital-board-governance",
    authDomain: "irpa-digital-board-governance.firebaseapp.com",
    gateway: "https://irpa-google-drive-gateway.irpa-governance.workers.dev"
  })
});

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function getFirebaseEnvironment(env = import.meta.env) {
  const name = String(env.VITE_IRPA_ENV || "").trim().toLowerCase();
  const environment = FIREBASE_ENVIRONMENTS[name];
  if (!environment) {
    throw new Error('VITE_IRPA_ENV must be explicitly set to "staging" or "production".');
  }
  const projectId = String(env.VITE_FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) throw new Error("VITE_FIREBASE_PROJECT_ID is required.");
  if (projectId !== environment.projectId) {
    throw new Error(`Firebase project "${projectId}" does not match VITE_IRPA_ENV "${name}".`);
  }
  return environment;
}

/**
 * Resolve the one permitted Cloudflare Gateway for this build.
 * Explicit URL overrides are accepted only when they agree with VITE_IRPA_ENV.
 */
export function resolveGatewayUrl(env = import.meta.env) {
  const environment = getFirebaseEnvironment(env);
  const configuredAuthDomain = String(env.VITE_FIREBASE_AUTH_DOMAIN || "").trim();
  if (configuredAuthDomain && configuredAuthDomain !== environment.authDomain) {
    throw new Error(`Firebase auth domain "${configuredAuthDomain}" conflicts with VITE_IRPA_ENV "${environment.name}". Gateway access is blocked.`);
  }
  const explicitUrls = [
    ["VITE_GATEWAY_ORIGIN", env.VITE_GATEWAY_ORIGIN],
    ["VITE_GOOGLE_DRIVE_GATEWAY_URL", env.VITE_GOOGLE_DRIVE_GATEWAY_URL],
    ["VITE_GOOGLE_DRIVE_GATEWAY_STAGING_URL", env.VITE_GOOGLE_DRIVE_GATEWAY_STAGING_URL],
    ["VITE_META_STAGING_GATEWAY_URL", env.VITE_META_STAGING_GATEWAY_URL]
  ].filter(([, value]) => String(value || "").trim());

  for (const [name, value] of explicitUrls) {
    if (normalizeUrl(value) !== environment.gateway) {
      throw new Error(`${name} conflicts with VITE_IRPA_ENV "${environment.name}". Expected ${environment.gateway}; received ${normalizeUrl(value)}. Gateway access is blocked.`);
    }
  }
  return environment.gateway;
}
