import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { declineSigning, getSigningPdf, openSigning, sign } from "../src/signing.mjs";
import { route } from "../src/router.mjs";
import { sha256Hex } from "../src/util.mjs";

const NOW = new Date("2026-10-07T17:00:00.000Z");
const ORIGINAL = await (async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  return pdf.save();
})();

async function makeFixture({ signerUid, signerEmail, secondSigner = true } = {}) {
  const secret = "a".repeat(64);
  const envelopeId = "ENV-TEST123";
  const signerId = "S1";
  const signers = [
    {
      id: signerId,
      email: signerEmail || "member@example.org",
      name: "Institutional Signer",
      order: 1,
      uid: signerUid,
      status: "Pending",
      tokenHash: null,
      invitation: "Sent"
    }
  ];
  if (secondSigner) {
    signers.push({
      id: "S2",
      email: "second@example.org",
      name: "Second Signer",
      order: 2,
      uid: "second-user",
      status: "Pending",
      tokenHash: null,
      invitation: "Pending"
    });
  }
  const envelope = {
    id: envelopeId,
    documentId: "DOC-TEST123",
    documentHash: null,
    title: "Controlled Signing Test",
    fileName: "controlled-test.pdf",
    classification: "Restricted",
    createdBy: "owner-user",
    status: "Sent",
    signers,
    archiveTargets: [],
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 86400000).toISOString(),
    events: [{ type: "envelope.created", hash: "GENESIS", prevHash: "GENESIS" }],
    completion: null,
    _v: 1
  };
  const state = new Map([["envelopes", envelope], ["documents", {
    id: envelope.documentId,
    status: "Stored",
    ownerUid: envelope.createdBy,
    hash: null,
    primaryStorageId: "original-1"
  }]]);
  return {
    token: envelopeId + "." + signerId + "." + secret,
    envelope,
    ctx: {
      env: {},
      now: () => new Date(NOW),
      config: { appUrl: "https://example.test", ttlDays: 14 },
      logger: { error() {} },
      verifyUser: async () => ({ uid: signerUid, email: signerEmail }),
      meta: {
        async get(collection, id) {
          if (collection === "envelopes" && id === envelopeId) return structuredClone(state.get("envelopes"));
          if (collection === "documents" && id === envelope.documentId) return structuredClone(state.get("documents"));
          return null;
        },
        async update(collection, id, patch, options = {}) {
          const current = state.get(collection);
          if (options.ifVersion != null && current._v !== options.ifVersion) throw new Error("unexpected version conflict");
          const next = { ...current, ...structuredClone(patch), _v: current._v + 1 };
          state.set(collection, next);
        }
      },
      storage: {
        async get(id) {
          if (id === "original-1") return ORIGINAL;
          return null;
        },
        async put() { return { id: "stored-test" }; },
        async delete() {}
      },
      sendInvitation: null,
      allowReturnTokens: true
    }
  };
}

test("Member: unauthenticated and wrong UID cannot open an institutional signing link", async () => {
  const fixture = await makeFixture({ signerUid: "member-uid", signerEmail: "member@example.org" });
  await assert.rejects(
    () => openSigning(fixture.ctx, fixture.token, null),
    error => error.status === 403 && error.message.includes("invited signer")
  );
  await assert.rejects(
    () => openSigning(fixture.ctx, fixture.token, { uid: "other-member", email: "member@example.org" }),
    error => error.status === 403
  );
});

test("Member: matching Firebase UID can open and retrieve the signing PDF", async () => {
  const fixture = makeFixture({ signerUid: "member-uid", signerEmail: "member@example.org" });
  const opened = await openSigning(fixture.ctx, fixture.token, {
    uid: "member-uid",
    email: "member@example.org"
  });
  assert.equal(opened.canSign, true);
  assert.equal(opened.signer.authenticated, true);

  const pdf = await getSigningPdf(fixture.ctx, fixture.token, {
    uid: "member-uid",
    email: "member@example.org"
  });
  assert.equal(pdf.fileName, "controlled-test.pdf");
  assert.deepEqual(pdf.bytes, ORIGINAL);
});

test("Member: matching UID can complete its signing action and the envelope advances", async () => {
  const fixture = makeFixture({ signerUid: "member-uid", signerEmail: "member@example.org" });
  const result = await sign(fixture.ctx, {
    token: fixture.token,
    signature: { type: "typed", value: "Member Signer" },
    consent: true,
    ip: "127.0.0.1",
    userAgent: "controlled-test",
    user: { uid: "member-uid", email: "member@example.org" }
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "InProgress");
  assert.equal(result.completed, false);
  assert.equal(fixture.ctx.meta ? (await fixture.ctx.meta.get("envelopes", fixture.envelope.id)).signers[0].status : null, "Signed");
});

test("Employee: matching Firebase UID is accepted; email alone is not an identity substitute", async () => {
  const fixture = makeFixture({ signerUid: "employee-uid", signerEmail: "employee@example.org" });
  await assert.rejects(
    () => openSigning(fixture.ctx, fixture.token, { uid: "different-uid", email: "employee@example.org" }),
    error => error.status === 403
  );
  const opened = await openSigning(fixture.ctx, fixture.token, {
    uid: "employee-uid",
    email: "employee@example.org"
  });
  assert.equal(opened.signer.authenticated, true);
});

test("Employee: authenticated router path passes the verified UID to open and submit", async () => {
  const fixture = makeFixture({ signerUid: "employee-uid", signerEmail: "employee@example.org" });
  fixture.ctx.verifyUser = async () => ({ uid: "employee-uid", email: "employee@example.org" });

  const openRequest = new Request("https://example.test/api/sign/open", {
    headers: { "x-signing-token": fixture.token }
  });
  const openResponse = await route(openRequest, fixture.ctx);
  assert.equal(openResponse.status, 200);
  const openBody = await openResponse.json();
  assert.equal(openBody.signer.authenticated, true);
  assert.equal(openBody.canSign, true);

  const submitRequest = new Request("https://example.test/api/sign/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: fixture.token,
      signature: { type: "typed", value: "Employee Signer" },
      consent: true
    })
  });
  const submitResponse = await route(submitRequest, fixture.ctx);
  assert.equal(submitResponse.status, 200);
  const submitBody = await submitResponse.json();
  assert.equal(submitBody.ok, true);
  assert.equal(submitBody.status, "InProgress");
});

test("UID-bound signer can decline only with the matching authenticated UID", async () => {
  const fixture = makeFixture({ signerUid: "member-uid", signerEmail: "member@example.org" });
  await assert.rejects(
    () => declineSigning(fixture.ctx, {
      token: fixture.token,
      reason: "controlled negative-path test",
      user: { uid: "wrong-user" }
    }),
    error => error.status === 403
  );
  const result = await declineSigning(fixture.ctx, {
    token: fixture.token,
    reason: "controlled positive-path test",
    user: { uid: "member-uid" }
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "Declined");
});

test("External token signer remains usable without Firebase authentication", async () => {
  const fixture = makeFixture({ signerUid: null, signerEmail: "external@example.org" });
  const opened = await openSigning(fixture.ctx, fixture.token, null);
  assert.equal(opened.signer.authenticated, false);
  assert.equal(opened.canSign, true);
  const pdf = await getSigningPdf(fixture.ctx, fixture.token, null);
  assert.deepEqual(pdf.bytes, ORIGINAL);
});
