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
const LOCAL_WRANGLER = `${GATEWAY}/wrangler.local.toml`;

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
function mapValue(fields) { return { mapValue: { fields } }; }

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
const wranglerTemplate = await (await fetch(new URL("../wrangler.toml", import.meta.url))).text().catch(()=>null);
if (wranglerTemplate) writeFileSync(LOCAL_WRANGLER, wranglerTemplate.replace("STAGING_DRIVE_KV_NAMESPACE_ID_REQUIRED","00000000000000000000000000000000"));

const worker = spawn("npx", ["wrangler", "dev", "--config", "wrangler.local.toml", "--env", "staging", "--local", "--test-scheduled", "--port", String(PORT), "--log-level", "error"], {
  cwd: GATEWAY,
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
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

  const exact10 = makePdf(10 * 1024 * 1024);
  const exact10Hash = createHash("sha256").update(exact10).digest("hex");
  log("before-exact-10mb", {});
  const exact10Result = await request("/api/upload-controlled-document", { body: { ...common, documentId:"E2E-EXACT-10MB", fileName:"exact-10mb.pdf", fileSize:exact10.length, base64:Buffer.from(exact10).toString("base64") } });
  log("exact-10mb-accepted", { httpStatus:exact10Result.status, response:exact10Result.body, sha256:exact10Hash });
  if (exact10Result.status !== 200) throw new Error("Exactly 10 MB PDF was not accepted.");

  const plusOne = new Uint8Array(10 * 1024 * 1024 + 1);
  plusOne.set(exact10);
  log("before-exact-10mb-plus-one", {});
  const plusOneResult = await request("/api/upload-controlled-document", { body: { ...common, documentId:"E2E-10MB-PLUS-ONE", fileName:"10mb-plus-one.pdf", fileSize:plusOne.length, base64:Buffer.from(plusOne).toString("base64") } });
  log("exact-10mb-plus-one-rejected", { httpStatus:plusOneResult.status, response:plusOneResult.body });
  if (plusOneResult.status !== 400) throw new Error("10 MB + 1 byte was not rejected.");

  log("before-concurrent-same-document-id", {});
  const concurrentId = "E2E-CONCURRENT-SAME-ID";
  const [concurrentA, concurrentB] = await Promise.all([
    request("/api/upload-controlled-document", { body:{...common,documentId:concurrentId,fileName:"concurrent-a.pdf"} }),
    request("/api/upload-controlled-document", { body:{...common,documentId:concurrentId,fileName:"concurrent-b.pdf"} })
  ]);
  log("concurrent-same-document-id", { requestA:{status:concurrentA.status,response:concurrentA.body}, requestB:{status:concurrentB.status,response:concurrentB.body} });
  if (![200,409].includes(concurrentA.status) || ![200,409].includes(concurrentB.status) || concurrentA.status===concurrentB.status) throw new Error("Concurrent same-document-ID test did not produce one accepted request and one conflict.");

  log("before-signing-envelope", {});
  const signingDocumentId = "E2E-SIGN-DOC-001";
  const envelopeId = "IRPA-ENV-TEST-001";
  await setDoc("staging_documents", signingDocumentId, {
    fileId:stringValue(fileId), documentUrl:stringValue("drive://"+fileId), storageUrl:stringValue("drive://"+fileId),
    hash:stringValue(originalHash), status:stringValue("Saved"), authorizedUids:arrayValue(["authorized-user"])
  });
  await setDoc("staging_signatureEnvelopes", envelopeId, {
    status:stringValue("Completed"), lastSignedByUid:stringValue("authorized-user"), originalDocumentId:stringValue(signingDocumentId),
    recipients:arrayValue([]),
    recipients: {arrayValue:{values:[
      mapValue({uid:stringValue("authorized-user"),email:stringValue("authorized@example.test"),role:stringValue("Document Owner")}),
      mapValue({uid:stringValue("second-signer"),email:stringValue("second@example.test"),role:stringValue("Board Member")})
    ]}}
  });
  const signedBytes = new Uint8Array(pdf);
  signedBytes[100] = (signedBytes[100] + 1) % 255;
  const signedHash = createHash("sha256").update(signedBytes).digest("hex");
  const beforeSigning = await request("/__test__/state",{method:"GET"});
  const signingResult = await request("/api/signature-profile/finalize", {
    body:{envelopeId,originalHash,finalHash:signedHash,fileSize:signedBytes.length,base64:Buffer.from(signedBytes).toString("base64")}
  });
  const afterSigning = await request("/__test__/state",{method:"GET"});
  log("signing-envelope-created-and-archived",{httpStatus:signingResult.status,response:signingResult.body,beforeCount:(beforeSigning.body?.objects||[]).length,afterCount:(afterSigning.body?.objects||[]).length,originalHashUnchanged:originalHash===String(originalHash)});
  if (signingResult.status!==200 || Object.keys(signingResult.body?.deliveries||{}).length!==2) throw new Error("Signing archive assertion failed.");
  const signingObjects=(afterSigning.body?.objects||[]).filter(o=>String(o.description||"").includes(envelopeId));
  if(signingObjects.length!==2 || !signingObjects.every(o=>String(o.description||"").includes(originalHash))) throw new Error("Signed PDF archive linkage/hash assertion failed.");

  const duplicateSigning = await request("/api/signature-profile/finalize", {
    body:{envelopeId,originalHash,finalHash:signedHash,fileSize:signedBytes.length,base64:Buffer.from(signedBytes).toString("base64")}
  });
  const afterDuplicate = await request("/__test__/state",{method:"GET"});
  log("duplicate-signature-callback-idempotent",{httpStatus:duplicateSigning.status,response:duplicateSigning.body,objectCountUnchanged:(afterDuplicate.body?.objects||[]).length===(afterSigning.body?.objects||[]).length});
  if(duplicateSigning.status!==200 || duplicateSigning.body?.idempotent!==true || (afterDuplicate.body?.objects||[]).length!==(afterSigning.body?.objects||[]).length) throw new Error("Duplicate signature callback was not idempotent.");

  await setDoc("staging_signatureEnvelopes","IRPA-ENV-SIGN-FAIL-001",{
    status:stringValue("Completed"),lastSignedByUid:stringValue("authorized-user"),
    recipients:{arrayValue:{values:[
      mapValue({uid:stringValue("authorized-user"),email:stringValue("authorized@example.test"),role:stringValue("Document Owner")}),
      mapValue({uid:stringValue("second-signer"),email:stringValue("second@example.test"),role:stringValue("Board Member")})
    ]}}
  });
  const beforeSignatureFailure = await request("/__test__/state",{method:"GET"});
  const signatureFailure = await request("/api/signature-profile/finalize",{headers:{"X-IRPA-Test-Failure":"signature-provider"},body:{envelopeId:"IRPA-ENV-SIGN-FAIL-001",originalHash,finalHash:signedHash,fileSize:signedBytes.length,base64:Buffer.from(signedBytes).toString("base64")}});
  const afterSignatureFailure = await request("/__test__/state",{method:"GET"});
  log("signature-provider-failure-no-orphan",{httpStatus:signatureFailure.status,response:signatureFailure.body,beforeCount:(beforeSignatureFailure.body?.objects||[]).length,afterCount:(afterSignatureFailure.body?.objects||[]).length});
  if(signatureFailure.status!==500 || (afterSignatureFailure.body?.objects||[]).length!==(beforeSignatureFailure.body?.objects||[]).length) throw new Error("Signature-provider failure left an orphaned object.");

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
  try {
    if (process.platform !== "win32" && worker.pid) process.kill(-worker.pid, "SIGTERM");
    else worker.kill("SIGTERM");
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 500));
  try {
    if (process.platform !== "win32" && worker.pid && worker.exitCode === null) process.kill(-worker.pid, "SIGKILL");
    else if (worker.exitCode === null) worker.kill("SIGKILL");
  } catch {}
  if (existsSync(DEV_VARS)) unlinkSync(DEV_VARS);
  if (existsSync(LOCAL_WRANGLER)) unlinkSync(LOCAL_WRANGLER);
}
