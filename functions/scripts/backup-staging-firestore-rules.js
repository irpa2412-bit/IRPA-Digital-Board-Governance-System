const fs = require("node:fs");
const { GoogleAuth } = require("google-auth-library");
const { PROJECT_ID, RELEASE_NAME, createBackup } = require("./staging-firestore-rules-release");

const RULES_API = "https://firebaserules.googleapis.com";

async function main() {
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const outputPath = process.argv[2] || process.env.STAGING_RULES_BACKUP_PATH;
  if (!credentialPath || !outputPath) throw new Error("Staging credentials and backup output path are required.");
  const credentials = JSON.parse(fs.readFileSync(credentialPath, "utf8"));
  if (credentials.project_id !== PROJECT_ID) throw new Error("Refusing backup: service account project does not match isolated staging.");

  const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const api = async (method, resource) => {
    const response = await client.request({ url: `${RULES_API}/v1/${resource}`, method });
    return response.data;
  };

  const release = await api("GET", RELEASE_NAME);
  if (!release?.rulesetName) throw new Error("Cannot publish safely: no active staging ruleset is available to back up.");
  const ruleset = await api("GET", release.rulesetName);
  const backup = createBackup({ release, ruleset });
  fs.writeFileSync(outputPath, JSON.stringify(backup, null, 2), { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify({
    ok: true,
    project: PROJECT_ID,
    release: RELEASE_NAME,
    backupCreated: true,
    rulesSourceSha256: backup.rulesSourceSha256
  }));
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, check: "backup-active-staging-firestore-rules", error: error?.message || "unknown error" }));
  process.exitCode = 1;
});
