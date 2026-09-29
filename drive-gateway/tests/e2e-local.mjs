import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url).pathname;
const GATEWAY = new URL("../", import.meta.url).pathname;
const PORT = 8787;
const FIRESTORE = "http://127.0.0.1:8080";
const PROJECT = "demo-irpa-staging";
const WORKER = `http://127.0.0.1:${PORT}`;
const DEV_VARS = `${GATEWAY}/.dev.vars.staging`;

function log(label, value) {
  console.log(JSON.stringify({ step: label, ...value }));
}

async function waitFor(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function firestore(path, init = {}) {
  const response = await fetch(`${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) }
  });
  const body = await response.text();
  let parsed = {};
  try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = { raw: body }; }
  if (!response.ok) throw new Error(`Firestore ${response.status}: ${body}`);
  return parsed;
}

function stringValue(value) { return { stringValue: String(value) }; }
function boolValue(value) { return { booleanValue: Boolean(value) }; }
function arrayValue(values) { return { arrayValue: { values: values.map(stringValue) } }; }

async function setDoc(collection, id, fields) {
  const response = await fetch(`${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}?documentId=${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Authorization": "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Firestore seed ${response.status}: ${body}`);
}

function makePdf(size) {
  const bytes = new Uint8Array(size);
  bytes.fill(0x20);
  const head = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");
  const tail = Buffer.from("\n%%EOF\n");
  bytes.set(head, 0);
  bytes.set(tail, size - tail.length);
  return bytes;
}

async function request(path, { uid = "authorized-user", email = "authorized@example.test", body, headers = {}, method = "POST" } = {}) {
  const response = await fetch(`${WORKER}${path}`, {
    method,
    headers: {
      Authorization: `Bearer test:${uid}:${email}`,
      "Content-Type": "application/json",
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  return { status: response.status, body: parsed };
}

const workerEnv = `DRIVE_MOCK="true"\nLOCAL_TEST_MODE="true"\nFIREBASE_PROJECT_ID="${PROJECT}"\nFIRESTORE_EMULATOR_HOST="127.0.0.1:8080"\nFIRESTORE_COLLECTION_PREFIX="staging_"\nDRIVE_ROOT_FOLDER_NAME="IRPA Governance System - STAGING"\n`;
writeFileSync(DEV_VARS, workerEnv);

const worker = spawn("npx", ["wrangler", "dev", "--config", "wrangler.toml", "--env", "staging", "--local", "--test-scheduled", "--port", String(PORT), "--log-level", "error"], {
  cwd: GATEWAY,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env }
});
worker.stdout.on("data", chunk => process.stdout.write(`[wrangler] ${chunk}`));
worker.stderr.on("data", chunk => process.stderr.write(`[wrangler] ${chunk}`));

try {
  await waitFor(`${WORKER}/health`);
  log("worker-ready", { status: 200 });

  await fetch(`${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE", signal: AbortSignal.timeout(30000) });
  await setDoc("staging_members", "authorized-user", {
    status: stringValue("Active"),
    email: stringValue("authorized@example.test"),
    name: stringValue("Authorized Test User")
  });

  const pdf = makePdf(3 * 1024 * 1024);
  const originalHash = createHash("sha256").update(pdf).digest("hex");
  const base64 = Buffer.from(pdf).toString("base64");
  const documentId = "E2E-STAGING-DOC-001";
  const common = {
    fileName: "staging-e2e.pdf",
    title: "Staging E2E PDF",
    reference: "STAGING-E2E-001",
    documentId,
    documentType: "Governance Document",
    archiveCategory: "Administrative Documents",
    classification: "Restricted",
    contentType: "application/pdf",
    fileSize: pdf.length,
    base64
  };

  log("before-valid-pdf", {});
  const valid = await request("/api/upload-controlled-document", { body: common });
  log("valid-pdf-accepted", { httpStatus: valid.status, response: valid.body });
  if (valid.status !== 200 || !valid.body?.documentId || !valid.body?.categoryArchive?.file?.fileId || !valid.body?.governanceArchive?.file?.fileId) throw new Error("Valid PDF upload assertion failed.");

  const fileId = valid.body.categoryArchive.file.fileId;
  log("before-metadata-record", {});
  await setDoc("staging_documents", documentId, {
    fileId: stringValue(fileId),
    fileName: stringValue("staging-e2e.pdf"),
    documentUrl: stringValue(`drive://${fileId}`),
    storageUrl: stringValue(`drive://${fileId}`),
    hash: stringValue(originalHash),
    status: stringValue("Saved"),
    authorizedUids: arrayValue(["authorized-user"])
  });
  log("metadata-record", { documentId, fileId, documentUrl: `drive://${fileId}`, storageUrl: `drive://${fileId}`, hash: originalHash, status: "Saved" });

  log("before-authorized-retrieval", {});
  const authorized = await request("/api/download", { body: { documentId, fileId } });
  const retrieved = Buffer.from(authorized.body?.base64 || "", "base64");
  const retrievedHash = createHash("sha256").update(retrieved).digest("hex");
  log("authorized-retrieval-sha256", { httpStatus: authorized.status, originalSha256: originalHash, retrievedSha256: retrievedHash, match: retrievedHash === originalHash });
  if (authorized.status !== 200 || retrievedHash !== originalHash) throw new Error("Authorized retrieval/hash assertion failed.");

  log("before-unauthorized-retrieval", {});
  const unauthorized = await request("/api/download", { uid: "unauthorized-user", email: "unauthorized@example.test", body: { documentId, fileId } });
  log("unauthorized-retrieval-denied", { httpStatus: unauthorized.status, response: unauthorized.body });
  if (unauthorized.status !== 403) throw new Error("Unauthorized retrieval was not denied.");

  log("before-wrong-document-id", {});
  const wrongId = await request("/api/download", { body: { documentId: "WRONG-DOCUMENT-ID", fileId } });
  log("wrong-document-id-denied", { httpStatus: wrongId.status, response: wrongId.body });
  if (wrongId.status !== 403) throw new Error("Wrong document ID was not denied.");

  log("before-renamed-non-pdf", {});
  const renamed = await request("/api/upload-controlled-document", {
    body: { ...common, documentId: "E2E-RENAMED-NON-PDF", fileName: "renamed.pdf", fileSize: 4, base64: Buffer.from("PK\x03\x04").toString("base64") }
  });
  log("renamed-non-pdf-rejected", { httpStatus: renamed.status, response: renamed.body });
  if (renamed.status !== 400 || !/not a valid PDF/i.test(renamed.body?.error || "")) throw new Error("Renamed non-PDF was not rejected.");

  const oversizedBytes = new Uint8Array(10 * 1024 * 1024 + 1);
  oversizedBytes[0] = 0x25; oversizedBytes[1] = 0x50; oversizedBytes[2] = 0x44; oversizedBytes[3] = 0x46; oversizedBytes[4] = 0x2D;
  log("before-oversized", {});
  const oversized = await request("/api/upload-controlled-document", {
    body: { ...common, documentId: "E2E-OVERSIZED", fileName: "oversized.pdf", fileSize: oversizedBytes.length, base64: Buffer.from(oversizedBytes).toString("base64") }
  });
  log("oversized-rejected", { httpStatus: oversized.status, response: oversized.body });
  if (oversized.status !== 400) throw new Error("Oversized file was not rejected.");

  log("before-rollback-baseline", {});
  const beforeRollback = await request("/__test__/state", { method: "GET" });
  log("rollback-baseline", { httpStatus: beforeRollback.status, state: beforeRollback.body });
  log("before-second-channel-failure", {});
  const rollback = await request("/api/upload-controlled-document", { headers: { "X-IRPA-Test-Failure": "second-channel" }, body: { ...common, documentId: "E2E-ROLLBACK-001" } });
  const afterRollback = await request("/__test__/state", { method: "GET" });
  log("second-channel-failure-rolls-back-first-object", { httpStatus: rollback.status, response: rollback.body, stateAfter: afterRollback.body });
  if (rollback.status !== 500 || (afterRollback.body?.objects || []).length !== (beforeRollback.body?.objects || []).length || (afterRollback.body?.pending || []).length !== 0) throw new Error("Second-channel rollback assertion failed.");

  log("before-rollback-delete-failure", {});
  const pendingFailure = await request("/api/upload-controlled-document", { headers: { "X-IRPA-Test-Failure": "second-channel-delete" }, body: { ...common, documentId: "E2E-PENDING-001" } });
  const pendingState = await request("/__test__/state", { method: "GET" });
  log("rollback-delete-failure-recorded-for-cleanup", { httpStatus: pendingFailure.status, response: pendingFailure.body, stateAfter: pendingState.body });
  if (pendingFailure.status !== 500 || (pendingState.body?.pending || []).length !== 1) throw new Error("Pending rollback record assertion failed.");

  log("before-cleanup-job", {});
  const cleanup = await fetch(`${WORKER}/cdn-cgi/local/scheduled?format=json`);
  const cleanupText = await cleanup.text();
  const cleanupState = await request("/__test__/state", { method: "GET" });
  log("cleanup-job-finds-and-removes-pending-record", { httpStatus: cleanup.status, response: cleanupText, stateAfter: cleanupState.body });
  if (!cleanup.ok || (cleanupState.body?.pending || []).length !== 0) throw new Error("Cleanup job did not clear the pending rollback.");

  console.log("E2E RESULT: PASS");
} finally {
  worker.kill("SIGTERM");
  if (existsSync(DEV_VARS)) unlinkSync(DEV_VARS);
}
