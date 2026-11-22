const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { GoogleAuth } = require("google-auth-library");

const API = "https://api.cloudflare.com/client/v4";
const GATEWAY_NAME = "irpa-google-drive-gateway";
const FRONTEND_NAME = "irpa-digital-board-governance-frontend";
const MIN_BUILD = "57368a8c2ceb418178aa28e5707b02605851dc83";
const output = (key, value) => fs.appendFileSync(process.env.GITHUB_OUTPUT, key + "=" + String(value) + "\n");
const summary = lines => fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers: { Accept: "application/json", ...headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw new Error("HTTP " + response.status);
  return body;
}
function activeVersion(body) {
  const deployments = body?.result?.deployments;
  const current = Array.isArray(deployments) ? deployments[0] : null;
  const active = (current?.versions || []).filter(row => Number(row.percentage) === 100);
  if (active.length !== 1 || !active[0].version_id) throw new Error("No unique 100% active Worker version");
  return String(active[0].version_id);
}
async function adminCredentialPreflight(serviceAccount) {
  try {
    if (!serviceAccount || serviceAccount.project_id !== "irpa-digital-board-governance") return false;
    if (!process.env.FIREBASE_WEB_API_KEY) return false;
    if (!getApps().length) initializeApp({ credential: cert(serviceAccount), projectId: "irpa-digital-board-governance" });
    const auth = getAuth();
    const admin = await auth.getUserByEmail("irpa2412@gmail.com");
    if (admin.customClaims?.admin !== true) return false;
    const customToken = await auth.createCustomToken(admin.uid);
    const response = await fetch(
      "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=" + encodeURIComponent(process.env.FIREBASE_WEB_API_KEY),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Referer: "https://irpa-digital-board-governance.web.app/" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true })
      }
    );
    const result = await response.json().catch(() => ({}));
    return response.ok && Boolean(result.idToken);
  } catch {
    return false;
  }
}
async function main() {
  const account = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const token = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
  if (!account || !token) throw new Error("Existing Cloudflare read credential path is unavailable.");
  const authHeader = { Authorization: "Bearer " + token };

  const gatewayDeployment = await getJson(API + "/accounts/" + account + "/workers/scripts/" + GATEWAY_NAME + "/deployments", authHeader);
  const gatewayVersion = activeVersion(gatewayDeployment);
  const frontendDeployment = await getJson(API + "/accounts/" + account + "/workers/scripts/" + FRONTEND_NAME + "/deployments", authHeader);
  const frontendVersion = activeVersion(frontendDeployment);

  const gatewayHealth = await getJson(process.env.GATEWAY_URL + "/health", { "Cache-Control": "no-cache" });
  if (gatewayHealth.ok !== true) throw new Error("Gateway /health did not return ok=true.");
  const gatewayCommit = String(gatewayHealth.commit || gatewayHealth.version || "unknown");

  const frontendResponse = await fetch(process.env.FRONTEND_URL + "/__irpa_health", { headers: { "Cache-Control": "no-cache" } });
  const frontendBody = await frontendResponse.json().catch(() => ({}));
  if (!frontendResponse.ok || frontendBody.ok !== true) throw new Error("Frontend Worker health endpoint failed.");

  const webResponse = await fetch(process.env.WEB_URL + "/index.html?__irpa_readonly=57368a8", {
    headers: { "Cache-Control": "no-cache" }
  });
  const html = await webResponse.text();
  if (!webResponse.ok) throw new Error("Firebase Hosting index.html returned HTTP " + webResponse.status);
  const commitMatch = html.match(/<meta\s+name=["']irpa-build-version["']\s+content=["']([^"']+)["']/i);
  const timeMatch = html.match(/<meta\s+name=["']irpa-build-time["']\s+content=["']([^"']+)["']/i);
  const buildCommit = String(commitMatch?.[1] || "NOT_RETRIEVED");
  const buildTime = String(timeMatch?.[1] || "NOT_RETRIEVED");
  if (!/^[0-9a-f]{40}$/i.test(buildCommit)) throw new Error("Live web build stamp is missing or is not a full commit SHA.");
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", MIN_BUILD, buildCommit], { stdio: "ignore" });
  } catch {
    throw new Error("Live web build is not verified as commit 57368a8 or a descendant of it.");
  }

  let serviceAccount = null;
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch {}
  const credentialAvailable = await adminCredentialPreflight(serviceAccount);

  let rulesVersion = "NOT_RETRIEVED";
  let rulesCreateTime = "NOT_RETRIEVED";
  if (serviceAccount && serviceAccount.project_id === "irpa-digital-board-governance") {
    try {
      if (!getApps().length) initializeApp({ credential: cert(serviceAccount), projectId: "irpa-digital-board-governance" });
      const googleAuth = new GoogleAuth({
        credentials: serviceAccount,
        scopes: ["https://www.googleapis.com/auth/firebase.readonly"]
      });
      const client = await googleAuth.getClient();
      const access = await client.getAccessToken();
      if (access?.token) {
        const releaseResponse = await fetch(
          "https://firebaserules.googleapis.com/v1/projects/irpa-digital-board-governance/releases/cloud.firestore",
          { headers: { Authorization: "Bearer " + access.token, Accept: "application/json" } }
        );
        const release = await releaseResponse.json().catch(() => ({}));
        if (releaseResponse.ok) {
          rulesVersion = String(release.rulesetName || release.name || "NOT_RETRIEVED");
          rulesCreateTime = String(release.createTime || "NOT_RETRIEVED");
        } else {
          rulesVersion = "NOT_RETRIEVED (HTTP " + releaseResponse.status + ")";
        }
      }
    } catch {
      rulesVersion = "NOT_RETRIEVED";
    }
  }

  output("canary_credential_available", credentialAvailable ? "true" : "false");
  summary([
    "## Live read-only verification",
    "- Gateway Worker active version: " + gatewayVersion,
    "- Gateway /health commit: " + gatewayCommit,
    "- Frontend Worker active version: " + frontendVersion,
    "- Frontend Worker health: HTTP " + frontendResponse.status + "; ok=true",
    "- Firebase Hosting build stamp: " + buildCommit,
    "- Firebase Hosting build time: " + buildTime,
    "- Firestore Rules release: " + rulesVersion,
    "- Firestore Rules release create time: " + rulesCreateTime,
    "- Approved Firebase admin credential path: " + (credentialAvailable ? "AVAILABLE" : "UNAVAILABLE"),
    "- Read-only requests only; no Firestore Rules or application data were written."
  ]);
  console.log("GATEWAY_WORKER_VERSION_ID=" + gatewayVersion);
  console.log("GATEWAY_HEALTH_COMMIT=" + gatewayCommit);
  console.log("FRONTEND_WORKER_VERSION_ID=" + frontendVersion);
  console.log("FRONTEND_HEALTH=HTTP " + frontendResponse.status);
  console.log("WEB_BUILD_COMMIT=" + buildCommit);
  console.log("WEB_BUILD_TIME=" + buildTime);
  console.log("FIRESTORE_RULES_VERSION=" + rulesVersion);
  console.log("CANARY_CREDENTIAL_PATH=" + (credentialAvailable ? "AVAILABLE" : "UNAVAILABLE"));
  console.log("ROLLBACK_VERSION_AVAILABLE=" + (rollbackAvailable ? "YES" : "NO"));
}
main().catch(error => {
  output("canary_credential_available", "false");
  output("rollback_version_available", "false");
  summary(["## Live read-only verification", "FAILED: " + String(error?.message || "Read-only inspection failed."), "No write request was made."]);
  console.error("READ_ONLY_VERIFICATION_FAILED: " + String(error?.message || "unknown error"));
  process.exitCode = 1;
});
