const fs = require("node:fs");
const { GoogleAuth } = require("google-auth-library");
const { PROJECT_ID, validateBackup, restoreRelease } = require("./staging-firestore-rules-release");

const RULES_API = "https://firebaserules.googleapis.com";

async function main() {
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const backupPath = process.argv[2] || process.env.STAGING_RULES_BACKUP_PATH;
  if (!credentialPath || !backupPath) throw new Error("Staging credentials and saved rules backup path are required.");
  const credentials = JSON.parse(fs.readFileSync(credentialPath, "utf8"));
  if (credentials.project_id !== PROJECT_ID) throw new Error("Refusing rollback: service account project does not match isolated staging.");
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  validateBackup(backup);

  const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const api = async (method, resource, data) => {
    const response = await client.request({ url: `${RULES_API}/v1/${resource}`, method, data });
    return response.data;
  };
  const result = await restoreRelease({ api, backup });
  console.log(JSON.stringify({
    ok: true,
    project: result.projectId,
    release: result.releaseName,
    verification: "previous-staging-ruleset-restored-and-read-back",
    recreatedRuleset: result.recreatedRuleset
  }));
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, check: "rollback-staging-firestore-rules", error: error?.message || "unknown error" }));
  process.exitCode = 1;
});
