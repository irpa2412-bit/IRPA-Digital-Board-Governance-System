const fs = require("node:fs");
const path = require("node:path");
const { GoogleAuth } = require("google-auth-library");

const PROJECT_ID = "irpa-dbg-staging-a73ec";
const RULES_API = "https://firebaserules.googleapis.com";
const RELEASE_NAME = `projects/${PROJECT_ID}/releases/cloud.firestore`;

async function main() {
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialPath) throw new Error("GOOGLE_APPLICATION_CREDENTIALS is required.");
  const credentials = JSON.parse(fs.readFileSync(credentialPath, "utf8"));
  if (credentials.project_id !== PROJECT_ID) {
    throw new Error("Refusing to deploy Firestore rules: service account project does not match isolated staging.");
  }

  const rulesPath = path.resolve("firestore.rules");
  const rulesContent = fs.readFileSync(rulesPath, "utf8");
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  });
  const client = await auth.getClient();
  const api = async (url, method, data, params) => {
    try {
      const response = await client.request({ url, method, data, params });
      return response.data;
    } catch (error) {
      const status = error?.response?.status || error?.code || "unknown";
      const message = error?.response?.data?.error?.message || error?.message || "unknown error";
      throw new Error(`Firebase Rules API ${method} ${url.replace(RULES_API, "")} failed (HTTP ${status}): ${message}`);
    }
  };

  let release = null;
  try {
    release = await api(`${RULES_API}/v1/${RELEASE_NAME}`, "GET");
  } catch (error) {
    if (!String(error.message).includes("(HTTP 404)")) throw error;
  }

  if (release?.rulesetName) {
    const activeRuleset = await api(`${RULES_API}/v1/${release.rulesetName}`, "GET");
    const existing = activeRuleset.source?.files?.find(file => file.name === "firestore.rules")?.content;
    if (existing === rulesContent) {
      console.log(JSON.stringify({
        ok: true,
        project: PROJECT_ID,
        action: "unchanged",
        release: RELEASE_NAME,
        ruleset: release.rulesetName
      }));
      return;
    }
  }

  const ruleset = await api(
    `${RULES_API}/v1/projects/${PROJECT_ID}/rulesets`,
    "POST",
    { source: { files: [{ name: "firestore.rules", content: rulesContent }] } }
  );
  if (!ruleset?.name) throw new Error("Firebase Rules API did not return a ruleset name.");

  if (release) {
    await api(`${RULES_API}/v1/${RELEASE_NAME}`, "PATCH", { release: { name: RELEASE_NAME, rulesetName: ruleset.name }, updateMask: "rulesetName" });
  } else {
    await api(`${RULES_API}/v1/projects/${PROJECT_ID}/releases`, "POST", {
      name: RELEASE_NAME,
      rulesetName: ruleset.name
    });
  }

  console.log(JSON.stringify({
    ok: true,
    project: PROJECT_ID,
    action: "published",
    release: RELEASE_NAME,
    ruleset: ruleset.name
  }));
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    check: "deploy-firestore-rules-to-staging-only",
    error: error?.message || "unknown error"
  }));
  process.exitCode = 1;
});
