import test from "node:test";
import assert from "node:assert/strict";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { memoryMeta, memoryStorage } from "../src/adapters.mjs";
import { makeContext, route } from "../src/router.mjs";
import { sha256Hex } from "../src/util.mjs";

const quiet = { error() {}, log() {} };
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function setup() {
  const storage = memoryStorage();
  const meta = memoryMeta();
  const invites = [];
  const clock = { t: new Date("2026-10-07T10:00:00Z") };
  const users = {
    u1: { uid: "u1" },
    u2: { uid: "u2" },
  };
  const ctx = makeContext({
    storage,
    meta,
    logger: quiet,
    now: () => new Date(clock.t),
    verifyUser: async (r) =>
      users[(r.headers.get("authorization") || "").replace("Bearer ", "")] ||
      null,
    sendInvitation: async (i) => invites.push(i),
    config: { appUrl: "https://app.example.test", ttlDays: 14 },
  });
  return {
    ctx,
    storage,
    meta,
    invites,
    tokenFor: (email) =>
      new URL(invites.find((i) => i.to === email).link).searchParams.get(
        "token",
      ),
  };
}

async function pdf(pageCount = 2) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) {
    d.addPage().drawText("Original Page " + (i + 1), { x: 50, y: 700 });
  }
  return d.save();
}

function uploadReq(bytes, options = {}) {
  const form = new FormData();
  form.set(
    "file",
    new Blob([bytes], { type: "application/pdf" }),
    options.name || "doc.pdf",
  );
  form.set("documentId", options.documentId || "DOC-G5");
  form.set("title", "Gate 5 Forensic Test Document");
  form.set("classification", "Restricted");
  form.set(
    "archives",
    JSON.stringify(["administrative-documents", "board-governance"]),
  );
  return new Request("https://gw.test/api/documents", {
    method: "POST",
    headers: { authorization: "Bearer u1" },
    body: form,
  });
}

const post = (path, body, user = "u1") =>
  new Request("https://gw.test" + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${user}`,
    },
    body: JSON.stringify(body),
  });

const get = (path, options = {}) =>
  new Request("https://gw.test" + path, {
    headers: {
      ...(options.user
        ? { authorization: `Bearer ${options.user}` }
        : {}),
      ...(options.token ? { "x-signing-token": options.token } : {}),
    },
  });

async function upload(s, id = "DOC-G5") {
  const bytes = await pdf(2);
  const response = await route(
    uploadReq(bytes, { documentId: id }),
    s.ctx,
  );
  assert.equal(response.status, 201);
  return { bytes, hash: await sha256Hex(bytes) };
}

async function createEnvelope(s, signer = {
  name: "Gate Five Signer",
  email: "g5.signer@example.org",
  order: 1,
}) {
  await upload(s);
  const response = await route(
    post("/api/envelopes", {
      documentId: "DOC-G5",
      signers: [signer],
      archives: ["legal-contracts", "board-governance"],
    }),
    s.ctx,
  );
  assert.equal(response.status, 201);
  return (await response.json()).envelopeId;
}

function submit(token, signature) {
  return post("/api/sign/submit", {
    token,
    consent: true,
    signature,
  });
}

async function completeSingle(s, signature) {
  const envelopeId = await createEnvelope(s);
  const token = s.tokenFor("g5.signer@example.org");
  const response = await route(submit(token, signature), s.ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.completed, true);
  const state = await s.meta.get("envelopes", envelopeId);
  assert.equal(state.status, "Completed");
  return { envelopeId, state };
}

async function getFinalPdf(s, token) {
  const response = await route(
    get("/api/sign/pdf", { token }),
    s.ctx,
  );
  return {
    response,
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

function hexNeedle(text) {
  return `<${Buffer.from(text, "latin1").toString("hex").toUpperCase()}>`;
}

async function decodedPageContent(doc, pageIndex) {
  const page = doc.getPage(pageIndex);
  const contents = page.node.Contents();
  const refs =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, i) => contents.get(i))
      : contents
        ? [contents]
        : [];
  const chunks = [];
  for (const ref of refs) {
    const stream = doc.context.lookup(ref);
    if (stream instanceof PDFRawStream) {
      chunks.push(decodePDFRawStream(stream).decode());
    }
  }
  return new TextDecoder("latin1").decode(
    Uint8Array.from(chunks.flatMap((chunk) => [...chunk])),
  );
}

async function assertCertificateText(bytes, expected) {
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 3);
  const content = await decodedPageContent(doc, 2);
  for (const value of expected) {
    assert.match(content, new RegExp(hexNeedle(value).replace(/[.*+?^$\{}()|[\]\\]/g, "\\$&")));
  }
  return doc;
}

async function completionFiles(s, state) {
  assert.ok(state.completion);
  assert.equal(state.completion.files.length, 4);
  return Promise.all(
    state.completion.files.map(async (file) => ({
      file,
      bytes: await s.storage.get(file.id),
    })),
  );
}

test("G5-01 — typed signature punching", async () => {
  const s = setup();
  const { state } = await completeSingle(s, {
    type: "typed",
    value: "Gate Five Typed Signature",
  });

  const token = s.tokenFor("g5.signer@example.org");
  const { response, bytes } = await getFinalPdf(s, token);
  assert.equal(response.status, 200);
  assert.equal(
    await sha256Hex(bytes),
    state.completion.finalHash,
  );

  await assertCertificateText(bytes, [
    "Electronic Signature Certificate",
    "Gate Five Signer",
    "g5.signer@example.org",
    "Method: typed",
    "Gate Five Typed Signature",
  ]);
});

test("G5-02 — drawn signature punching", async () => {
  const s = setup();
  const { state } = await completeSingle(s, {
    type: "drawn",
    value: PNG,
  });

  const token = s.tokenFor("g5.signer@example.org");
  const { response, bytes } = await getFinalPdf(s, token);
  assert.equal(response.status, 200);
  assert.equal(await sha256Hex(bytes), state.completion.finalHash);

  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 3);
  const resources = doc.getPage(2).node.Resources();
  assert.ok(resources);
  const xObject = resources.lookupMaybe(
    PDFName.of("XObject"),
    PDFDict,
  );
  assert.ok(xObject);
  assert.ok(xObject.keys().length > 0, "certificate page has no embedded XObject");
});

test("G5-03 — original document preservation", async () => {
  const s = setup();
  const original = await upload(s);
  const document = await s.meta.get("documents", "DOC-G5");
  const originalStorageIds = document.archives.map((x) => x.id);
  const originalBytesBefore = await Promise.all(
    originalStorageIds.map((id) => s.storage.get(id)),
  );

  const envelopeIdResponse = await route(
    post("/api/envelopes", {
      documentId: "DOC-G5",
      signers: [
        {
          name: "Gate Five Signer",
          email: "g5.signer@example.org",
          order: 1,
        },
      ],
      archives: ["legal-contracts", "board-governance"],
    }),
    s.ctx,
  );
  assert.equal(envelopeIdResponse.status, 201);
  const token = s.tokenFor("g5.signer@example.org");
  assert.equal(
    (await route(
      submit(token, { type: "typed", value: "Preservation Signature" }),
      s.ctx,
    )).status,
    200,
  );

  const after = await s.meta.get("documents", "DOC-G5");
  assert.equal(after.hash, original.hash);
  assert.equal(after.size, original.bytes.length);
  assert.equal(after.pageCount, 2);

  for (let i = 0; i < originalStorageIds.length; i += 1) {
    assert.deepEqual(
      await s.storage.get(originalStorageIds[i]),
      originalBytesBefore[i],
    );
    assert.equal(
      await sha256Hex(await s.storage.get(originalStorageIds[i])),
      original.hash,
    );
  }

  const envelope = await s.meta.get("envelopes", "ENV-" + "");
  const allEnvelopes = await s.meta.list("envelopes");
  const completed = allEnvelopes.find((e) => e.documentId === "DOC-G5");
  assert.ok(completed);
  const finalBytes = await s.storage.get(completed.completion.primaryStorageId);
  const finalDoc = await PDFDocument.load(finalBytes);
  const originalDoc = await PDFDocument.load(original.bytes);
  assert.equal(finalDoc.getPageCount(), originalDoc.getPageCount() + 1);
  for (let i = 0; i < originalDoc.getPageCount(); i += 1) {
    assert.deepEqual(finalDoc.getPage(i).getSize(), originalDoc.getPage(i).getSize());
  }
  assert.equal(finalDoc.getPage(2).getSize().width, 595.28);
  assert.equal(finalDoc.getPage(2).getSize().height, 841.89);
});

test("G5-04 — final hash exactness", async () => {
  const s = setup();
  const { state } = await completeSingle(s, {
    type: "typed",
    value: "Hash Exactness",
  });
  const primary = await s.storage.get(state.completion.primaryStorageId);
  assert.ok(primary);
  assert.equal(await sha256Hex(primary), state.completion.finalHash);
});

test("G5-05 — all-copy equality", async () => {
  const s = setup();
  const { state } = await completeSingle(s, {
    type: "typed",
    value: "Copy Equality",
  });
  const files = await completionFiles(s, state);
  for (const { file, bytes } of files) {
    assert.ok(bytes, `missing persisted artifact ${file.id}`);
    assert.equal(await sha256Hex(bytes), state.completion.finalHash);
  }
});

test("G5-06 — retrieval equality", async () => {
  const s = setup();
  const { state } = await completeSingle(s, {
    type: "typed",
    value: "Retrieval Equality",
  });
  const token = s.tokenFor("g5.signer@example.org");
  const { response, bytes } = await getFinalPdf(s, token);
  assert.equal(response.status, 200);
  assert.equal(await sha256Hex(bytes), state.completion.finalHash);
  assert.equal(
    await sha256Hex(await s.storage.get(state.completion.primaryStorageId)),
    state.completion.finalHash,
  );
});

test("G5-07 — signed-PDF tamper detection", async () => {
  const s = setup();
  const { state } = await completeSingle(s, {
    type: "typed",
    value: "Tamper Detection",
  });
  const tampered = await s.storage.get(state.completion.primaryStorageId);
  assert.ok(tampered);
  tampered[tampered.length - 1] ^= 0xff;
  s.storage.objs.get(state.completion.primaryStorageId).bytes = tampered;

  const token = s.tokenFor("g5.signer@example.org");
  const response = await route(
    get("/api/sign/pdf", { token }),
    s.ctx,
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Integrity check failed.",
  });
});

test("G5-08 — partial completion rollback", async () => {
  const s = setup();
  const envelopeId = await createEnvelope(s);
  const token = s.tokenFor("g5.signer@example.org");

  s.storage.failPutWhen = (n) => n === 4;
  const response = await route(
    submit(token, { type: "typed", value: "Rollback Signature" }),
    s.ctx,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "CompletionFailed",
    completed: false,
  });

  const state = await s.meta.get("envelopes", envelopeId);
  assert.equal(state.status, "CompletionFailed");
  assert.equal(state.completion, null);

  const objects = [...s.storage.objs.values()];
  assert.equal(objects.length, 2);
  assert.ok(objects.every((o) => o.metadata?.documentId === "DOC-G5"));
  assert.ok(objects.every((o) => !String(o.metadata?.state || "").includes("Final Completed Document")));
  assert.equal(
    [...(await s.meta.list("envelopes"))].filter(
      (e) => e.status === "Completed",
    ).length,
    0,
  );
});

test("G5-09 — retry persistence", async () => {
  const s = setup();
  const envelopeId = await createEnvelope(s);
  const token = s.tokenFor("g5.signer@example.org");

  s.storage.failPutWhen = (n) => n === 4;
  assert.equal(
    (await route(
      submit(token, { type: "typed", value: "Retry Signature" }),
      s.ctx,
    )).status,
    200,
  );
  assert.equal((await s.meta.get("envelopes", envelopeId)).status, "CompletionFailed");

  s.storage.failPutWhen = null;
  const retry = await route(
    post(`/api/envelopes/${envelopeId}/retry-completion`, {}),
    s.ctx,
  );
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), {
    ok: true,
    completed: true,
    completion: JSON.parse(
      JSON.stringify((await s.meta.get("envelopes", envelopeId)).completion),
    ),
  });

  const state = await s.meta.get("envelopes", envelopeId);
  assert.equal(state.status, "Completed");
  const files = await completionFiles(s, state);
  for (const { bytes } of files) {
    assert.ok(bytes);
    assert.equal(await sha256Hex(bytes), state.completion.finalHash);
  }
  assert.equal(s.storage.objs.size, 6);
});

test("G5-10 — completion idempotency", async () => {
  const s = setup();
  const { envelopeId, state: first } = await completeSingle(s, {
    type: "typed",
    value: "Idempotent Signature",
  });
  const firstCompletion = structuredClone(first.completion);
  const firstCount = s.storage.objs.size;
  const retry = await route(
    post(`/api/envelopes/${envelopeId}/retry-completion`, {}),
    s.ctx,
  );
  assert.equal(retry.status, 200);
  const secondBody = await retry.json();
  const second = await s.meta.get("envelopes", envelopeId);

  assert.equal(secondBody.completed, true);
  assert.deepEqual(second.completion, firstCompletion);
  assert.equal(second.completion.finalHash, firstCompletion.finalHash);
  assert.equal(s.storage.objs.size, firstCount);

  const files = await completionFiles(s, second);
  for (const { bytes } of files) {
    assert.ok(bytes);
    assert.equal(await sha256Hex(bytes), second.completion.finalHash);
  }
});
