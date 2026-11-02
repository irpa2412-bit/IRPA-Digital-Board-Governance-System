import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { PDFDocument } from "pdf-lib";
import { memoryMeta, memoryStorage } from "../src/adapters.mjs";
import { generateSignerKeyPair, createSignerKeyProvider } from "../src/cryptographicGate.mjs";
import { chainEvents, finalizeEnvelope, openSigning, sign, verifyCompletedEnvelope } from "../src/signing.mjs";
import { sha256Hex } from "../src/util.mjs";

const drawnPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/fJQAAAAASUVORK5CYII=";

async function makeSourcePdf() {
  const pdf = await PDFDocument.create();
  for (let page = 1; page <= 3; page++) {
    const p = pdf.addPage([612, 792]);
    p.drawText("IRPA SOURCE PAGE " + page + " UNIQUE TEXT", { x: 50, y: 700, size: 18 });
  }
  return new Uint8Array(await pdf.save());
}

async function completedFixture() {
  const meta = memoryMeta();
  const storage = memoryStorage();
  const sourceBytes = await makeSourcePdf();
  const sourceHash = await sha256Hex(sourceBytes);
  const stored = await storage.put({ path: "source.pdf", bytes: sourceBytes, contentType: "application/pdf" });
  const document = { id: "DOC-VERIFY-001", hash: sourceHash, sha256: sourceHash, fileSize: sourceBytes.length, primaryStorageId: stored.id, title: "Three page verification fixture", fileName: "source.pdf" };
  await meta.create("documents", document.id, document);
  const signers = [
    { id: "S1", uid: "signer-drawn", name: "Drawn Signer", email: "drawn@example.test", order: 1, status: "Signed", signedAt: "2026-11-02T10:00:00.000Z", signatureType: "drawn", signatureValue: drawnPng, fieldValues: { field_drawn: drawnPng }, ip: "192.0.2.1" },
    { id: "S2", uid: "signer-typed", name: "Typed Signer", email: "typed@example.test", order: 2, status: "Signed", signedAt: "2026-11-02T10:05:00.000Z", signatureType: "typed", signatureValue: "Typed Signature Example", fieldValues: { field_typed: "Typed Signature Example" }, ip: "192.0.2.2" },
  ];
  const fields = [
    { fieldId: "field_drawn", type: "Signature", page: 2, x: 10, y: 70, width: 30, height: 10, signerUid: "signer-drawn" },
    { fieldId: "field_typed", type: "Signature", page: 3, x: 10, y: 70, width: 35, height: 10, signerUid: "signer-typed" },
  ];
  let events = await chainEvents([], { type: "envelope.created", at: "2026-11-02T09:00:00.000Z", actor: "admin-1", documentHash: sourceHash, signerCount: 2 });
  events = await chainEvents(events, { type: "signer.signed", signerId: "S1", at: signers[0].signedAt, signatureType: "drawn", signatureHash: await sha256Hex(drawnPng) });
  events = await chainEvents(events, { type: "signer.signed", signerId: "S2", at: signers[1].signedAt, signatureType: "typed", signatureHash: await sha256Hex(signers[1].signatureValue) });
  const envelope = {
    id: "ENV-VERIFY-001", documentId: document.id, documentHash: sourceHash, sha256: sourceHash, byteLength: sourceBytes.length,
    title: document.title, fileName: document.fileName, classification: "Restricted", createdBy: "admin-1", status: "Completing",
    signingMode: "Sequential", signers, fields, archiveTargets: ["legal-contracts"],
    createdAt: "2026-11-02T09:00:00.000Z", expiresAt: "2026-11-16T09:00:00.000Z", events, completion: null,
  };
  await meta.create("envelopes", envelope.id, envelope);
  const keyRecords = new Map();
  for (const signer of signers) keyRecords.set(signer.uid, { keyId: "KEY-" + signer.id, ...(await generateSignerKeyPair()) });
  const ctx = {
    meta, storage, env: { IRPA_ENVIRONMENT: "production", DRIVE_MOCK: "false" },
    crypto: { keyProvider: createSignerKeyProvider(keyRecords) },
    now: () => new Date("2026-11-02T10:10:00.000Z"), config: { ttlDays: 14 },
  };
  const finalized = await finalizeEnvelope(ctx, envelope.id);
  assert.equal(finalized.completed, true);
  return { meta, storage, ctx, envelope, document, sourceBytes, finalized };
}

test("admin verifier passes a two-signer, three-page completed PDF and confirms certificate bindings", async () => {
  const f = await completedFixture();
  const result = await verifyCompletedEnvelope(f.ctx, { uid: "admin-1", isAdmin: true }, f.envelope.id);
  assert.equal(result.verified, true, JSON.stringify(result.checks));
  assert.ok(result.checks.every(check => check.status === "PASS"));
  const finalBytes = await f.storage.get((await f.meta.get("envelopes", f.envelope.id)).completion.primaryStorageId);
  const extracted = spawnSync("pdftotext", ["-layout", "-", "-"], { input: finalBytes, encoding: "utf8" });
  assert.equal(extracted.status, 0, extracted.stderr);
  for (const text of ["IRPA SOURCE PAGE 1 UNIQUE TEXT", "IRPA SOURCE PAGE 2 UNIQUE TEXT", "IRPA SOURCE PAGE 3 UNIQUE TEXT", "Drawn Signer", "Typed Signer", "Electronic Signature Certificate"]) {
    assert.ok(extracted.stdout.includes(text), "missing PDF text: " + text);
  }
  const pages = extracted.stdout.split("\f");
  assert.ok(pages[1]?.includes("IRPA SOURCE PAGE 2 UNIQUE TEXT"));
  assert.ok(pages[2]?.includes("IRPA SOURCE PAGE 3 UNIQUE TEXT"));
  assert.ok(pages[3]?.includes("Drawn Signer") && pages[3]?.includes("Typed Signer"), "certificate page must list both signers");
  const images = spawnSync("pdfimages", ["-list", "-"], { input: finalBytes, encoding: "utf8" });
  assert.equal(images.status, 0, images.stderr);
  assert.match(images.stdout, /\s2\s+\d+\s+image\s/);
});

test("admin verifier fails when the stored source bytes are tampered", async () => {
  const f = await completedFixture();
  const changed = new Uint8Array(f.sourceBytes);
  changed[changed.length - 20] ^= 1;
  const replacement = await f.storage.put({ path: "tampered-source.pdf", bytes: changed, contentType: "application/pdf" });
  await f.meta.update("documents", f.document.id, { primaryStorageId: replacement.id });
  const result = await verifyCompletedEnvelope(f.ctx, { uid: "admin-1", isAdmin: true }, f.envelope.id);
  assert.equal(result.verified, false);
  assert.equal(result.checks.find(check => check.id === "source_sha256")?.status, "FAIL");
});

test("verifier is administrator-only", async () => {
  const f = await completedFixture();
  await assert.rejects(
    () => verifyCompletedEnvelope(f.ctx, { uid: "ordinary-user", isAdmin: false }, f.envelope.id),
    error => error.status === 403,
  );
});

test("signer outside the envelope cannot open the signing task", async () => {
  const f = await completedFixture();
  const signerSecret = "a".repeat(64);
  const env = await f.meta.get("envelopes", f.envelope.id);
  env.signers[0].tokenHash = await sha256Hex(signerSecret);
  await f.meta.update("envelopes", env.id, { signers: env.signers });
  await assert.rejects(
    () => openSigning(f.ctx, env.id + ".S1." + signerSecret, { uid: "not-assigned" }),
    error => error.status === 403,
  );
});

test("replayed signer submission is idempotent and does not append a second signing event", async () => {
  const meta = memoryMeta(), storage = memoryStorage();
  const sourceBytes = await makeSourcePdf(), sourceHash = await sha256Hex(sourceBytes);
  const stored = await storage.put({ path: "replay-source.pdf", bytes: sourceBytes, contentType: "application/pdf" });
  await meta.create("documents", "DOC-REPLAY-001", { id: "DOC-REPLAY-001", hash: sourceHash, fileSize: sourceBytes.length, primaryStorageId: stored.id, title: "Replay", fileName: "replay.pdf" });
  const secret = "b".repeat(64);
  const signer = { id: "S1", uid: "signer-replay", name: "Replay Signer", email: "replay@example.test", order: 1, status: "Pending", tokenHash: await sha256Hex(secret), invitation: "Sent" };
  const events = await chainEvents([], { type: "envelope.created", at: "2026-11-02T09:00:00.000Z", actor: "admin-1", documentHash: sourceHash, signerCount: 1 });
  await meta.create("envelopes", "ENV-REPLAY-001", { id: "ENV-REPLAY-001", documentId: "DOC-REPLAY-001", documentHash: sourceHash, sha256: sourceHash, byteLength: sourceBytes.length, title: "Replay", fileName: "replay.pdf", createdBy: "admin-1", status: "Sent", signingMode: "Sequential", signers: [signer], fields: [], archiveTargets: ["legal-contracts"], createdAt: "2026-11-02T09:00:00.000Z", expiresAt: "2026-11-16T09:00:00.000Z", events, completion: null });
  const ctx = { meta, storage, env: { IRPA_ENVIRONMENT: "test", DRIVE_MOCK: "true" }, now: () => new Date("2026-11-02T10:00:00.000Z"), config: { ttlDays: 14 }, verifySigningAuthority: async () => ({ verified: true }) };
  const token = "ENV-REPLAY-001.S1." + secret;
  const input = { token, signature: { type: "typed", value: "Replay Signature" }, consent: true, user: { uid: signer.uid } };
  const first = await sign(ctx, input);
  assert.equal(first.status, "Completed");
  const before = await meta.get("envelopes", "ENV-REPLAY-001");
  const second = await sign(ctx, input);
  const after = await meta.get("envelopes", "ENV-REPLAY-001");
  assert.equal(second.idempotent, true);
  assert.equal(after.events.filter(event => event.type === "signer.signed").length, 1);
  assert.equal(after.events.length, before.events.length);
});
