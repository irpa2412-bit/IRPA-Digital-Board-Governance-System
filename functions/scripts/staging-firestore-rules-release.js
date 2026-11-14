const crypto = require("node:crypto");

const PROJECT_ID = "irpa-dbg-staging-a73ec";
const RELEASE_NAME = `projects/${PROJECT_ID}/releases/cloud.firestore`;
const RULESET_COLLECTION = `projects/${PROJECT_ID}/rulesets`;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function createBackup({ release, ruleset, projectId = PROJECT_ID, savedAt = new Date().toISOString() }) {
  if (projectId !== PROJECT_ID) throw new Error("Refusing backup: project is not the fixed staging project.");
  if (release?.name !== RELEASE_NAME || !release?.rulesetName) throw new Error("Active staging Firestore release is missing or invalid.");
  if (ruleset?.name !== release.rulesetName) throw new Error("Active staging ruleset does not match the active release.");
  const rulesSource = ruleset.source?.files?.find(file => file.name === "firestore.rules")?.content;
  if (typeof rulesSource !== "string" || !rulesSource.length) throw new Error("Active staging ruleset source is missing.");
  return {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    releaseName: RELEASE_NAME,
    rulesetName: release.rulesetName,
    sourceFile: "firestore.rules",
    rulesSource,
    rulesSourceSha256: sha256(rulesSource),
    savedAt
  };
}

function validateBackup(backup) {
  if (backup?.schemaVersion !== 1 || backup.projectId !== PROJECT_ID || backup.releaseName !== RELEASE_NAME) {
    throw new Error("Refusing rollback: backup does not belong to the fixed staging Firestore release.");
  }
  if (backup.sourceFile !== "firestore.rules" || typeof backup.rulesSource !== "string" || !backup.rulesSource.length) {
    throw new Error("Refusing rollback: backup rules source is missing.");
  }
  if (sha256(backup.rulesSource) !== backup.rulesSourceSha256) {
    throw new Error("Refusing rollback: saved rules source hash does not match.");
  }
}

async function restoreRelease({ api, backup }) {
  if (typeof api !== "function") throw new Error("A Firebase Rules API request function is required.");
  validateBackup(backup);

  let targetRulesetName = backup.rulesetName;
  let existingRuleset = null;
  try {
    existingRuleset = await api("GET", targetRulesetName);
  } catch (error) {
    if (Number(error?.status || error?.response?.status) !== 404) throw error;
  }

  const existingSource = existingRuleset?.source?.files?.find(file => file.name === "firestore.rules")?.content;
  if (existingRuleset && existingSource !== backup.rulesSource) {
    throw new Error("Refusing rollback: previous ruleset source differs from the saved backup.");
  }

  if (!existingRuleset) {
    const recreated = await api("POST", RULESET_COLLECTION, {
      source: { files: [{ name: "firestore.rules", content: backup.rulesSource }] }
    });
    if (!recreated?.name) throw new Error("Firebase Rules API did not return a recreated backup ruleset.");
    targetRulesetName = recreated.name;
  }

  await api("PATCH", RELEASE_NAME, {
    release: { name: RELEASE_NAME, rulesetName: targetRulesetName },
    updateMask: "rulesetName"
  });

  const restoredRelease = await api("GET", RELEASE_NAME);
  if (restoredRelease?.rulesetName !== targetRulesetName) {
    throw new Error("Rollback verification failed: active staging release does not point to the saved ruleset.");
  }

  return {
    ok: true,
    projectId: PROJECT_ID,
    releaseName: RELEASE_NAME,
    restoredRulesetName: targetRulesetName,
    originalBackupRulesetName: backup.rulesetName,
    recreatedRuleset: targetRulesetName !== backup.rulesetName
  };
}

module.exports = {
  PROJECT_ID,
  RELEASE_NAME,
  RULESET_COLLECTION,
  createBackup,
  validateBackup,
  restoreRelease
};
