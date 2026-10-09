import process from "node:process";

const rawUrl = String(process.env.LIVEKIT_STAGING_URL || "").trim();
const apiKey = String(process.env.LIVEKIT_STAGING_API_KEY || "").trim();
const apiSecret = String(process.env.LIVEKIT_STAGING_API_SECRET || "").trim();

function fail(message) {
  console.error(`LIVEKIT STAGING PREFLIGHT: FAIL — ${message}`);
  process.exit(1);
}

if (!rawUrl || !apiKey || !apiSecret) {
  fail("Set LIVEKIT_STAGING_URL, LIVEKIT_STAGING_API_KEY, and LIVEKIT_STAGING_API_SECRET in the protected staging environment. Values are never printed.");
}

let livekitUrl;
try {
  livekitUrl = new URL(rawUrl);
} catch {
  fail("LIVEKIT_STAGING_URL must be a valid wss:// URL.");
}

if (livekitUrl.protocol !== "wss:" || !livekitUrl.hostname || livekitUrl.username || livekitUrl.password) {
  fail("LIVEKIT_STAGING_URL must use wss://, include a hostname, and contain no embedded credentials.");
}
if (["localhost", "127.0.0.1", "::1"].includes(livekitUrl.hostname.toLowerCase())) {
  fail("A local-only endpoint cannot be used for a real two-browser internet test.");
}

const probeUrl = new URL(livekitUrl.href);
probeUrl.protocol = "https:";
probeUrl.pathname = "/";
probeUrl.search = "";
probeUrl.hash = "";

try {
  const response = await fetch(probeUrl, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
    headers: { "User-Agent": "IRPA-DBGS-LiveKit-Staging-Preflight/1.0" }
  });

  // LiveKit's documented VM setup can return 404 at the root. A successful
  // TLS connection with a normal LiveKit root response proves reachability,
  // not authentication, token issuance, or a media session.
  const accepted = [200, 301, 302, 307, 308, 401, 404, 426].includes(response.status);
  if (!accepted) fail(`TLS endpoint responded with unexpected HTTP status ${response.status}.`);
  if ([301, 302, 307, 308].includes(response.status)) {
    fail("Endpoint redirected; configure the canonical WSS hostname directly and rerun.");
  }
  console.log("LIVEKIT STAGING PREFLIGHT: PASS — WSS URL shape, protected credentials present, HTTPS/TLS endpoint reachable.");
  console.log(`HTTP probe status: ${response.status}`);
  console.log("LIMIT: This is only a reachability check. It does not prove valid LiveKit credentials, Firebase token issuance, TURN traversal, or browser-to-browser audio/video.");
} catch (error) {
  if (String(error?.message || "").startsWith("LIVEKIT STAGING PREFLIGHT")) throw error;
  fail(`TLS endpoint could not be reached: ${error?.cause?.code || error?.name || "network/TLS error"}.`);
}
