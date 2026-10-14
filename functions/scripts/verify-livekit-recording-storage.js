const crypto = require("node:crypto");
const { GoogleAuth } = require("google-auth-library");

const bucket = String(process.env.LIVEKIT_PRODUCTION_RECORDING_BUCKET || "").trim();
const credentials = JSON.parse(String(process.env.LIVEKIT_PRODUCTION_RECORDING_GCP_CREDENTIALS_JSON || "{}"));
if (!bucket) throw new Error("Missing LIVEKIT_PRODUCTION_RECORDING_BUCKET.");
if (credentials.project_id !== "irpa-digital-board-governance" ||
    credentials.client_email !== "irpa-livekit-recorder@irpa-digital-board-governance.iam.gserviceaccount.com" ||
    !credentials.private_key) {
  throw new Error("Use the dedicated production recording service account for the production GCS bucket.");
}
async function main() {
  const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/devstorage.read_write"] });
  const client = await auth.getClient();
  const token = (await client.getAccessToken()).token;
  if (!token) throw new Error("Could not obtain a Google Cloud Storage access token.");
  const objectName = "irpa-governance-recordings/_release-preflight/" + Date.now() + "-" + crypto.randomBytes(6).toString("hex") + ".txt";
  const value = "IRPA LiveKit production storage acceptance " + new Date().toISOString();
  const base = "https://storage.googleapis.com/storage/v1/b/" + encodeURIComponent(bucket) + "/o";
  const upload = await fetch("https://storage.googleapis.com/upload/storage/v1/b/" + encodeURIComponent(bucket) + "/o?uploadType=media&name=" + encodeURIComponent(objectName), {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "text/plain" }, body: value
  });
  if (!upload.ok) throw new Error("Production recording bucket write check failed: HTTP " + upload.status + " " + (await upload.text()).slice(0, 250));
  const read = await fetch(base + "/" + encodeURIComponent(objectName) + "?alt=media", { headers: { Authorization: "Bearer " + token } });
  if (!read.ok || (await read.text()) !== value) throw new Error("Production recording bucket read-after-write verification failed.");
  const remove = await fetch(base + "/" + encodeURIComponent(objectName), { method: "DELETE", headers: { Authorization: "Bearer " + token } });
  if (!remove.ok) throw new Error("Production recording bucket cleanup failed: HTTP " + remove.status);
  console.log(JSON.stringify({ ok: true, check: "production-recording-storage-write-read-delete", bucket, serviceAccount: credentials.client_email, objectCleanup: "passed" }, null, 2));
}
main().catch(e => { console.error(JSON.stringify({ ok: false, check: "production-recording-storage-write-read-delete", error: e.message || "Unknown storage error" })); process.exitCode = 1; });
