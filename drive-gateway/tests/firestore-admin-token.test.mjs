import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { filterSignatureEnvelopeForCaller } from "../src/signatureWorkflowVisibility.mjs";

const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const lifecycle = await readFile(new URL("../src/documentLifecycle.mjs", import.meta.url), "utf8");

test("signing asset and completed-archive routes explicitly use the Worker's admin token", () => {
  const download = source.slice(source.indexOf("async function downloadSignatureFile"), source.indexOf("async function finalizeSignatureProfileArchives"));
  const completed = source.slice(source.indexOf("async function finalizeSignatureProfileArchives"), source.indexOf("async function ensureSignatureProfileFolder"));
  assert.ok(download.includes("const firestoreAdminToken = await getFirestoreAdminAccessToken(env)"));
  assert.doesNotMatch(download, /getFirestoreDocument\([^;\n]*claims\.token/);
  assert.ok(completed.includes("await getFirestoreAdminAccessToken(env)"));
});

test("signing and Drive lifecycle routes never pass the caller token to Firestore document helpers", () => {
  assert.doesNotMatch(source, /getFirestoreDocument\([^;\n]*claims\.token/);
  assert.doesNotMatch(source, /updateFirestoreDocument\([^;\n]*claims\.token/);
  assert.doesNotMatch(lifecycle, /getFirestoreDocument\([^;\n]*claims\.token/);
  assert.doesNotMatch(lifecycle, /updateFirestoreDocument\([^;\n]*claims\.token/);
  assert.match(lifecycle, /deps\.getFirestoreAdminAccessToken\(env\)/);
});

test("admin, owner, current signer and earlier signer receive only their authorised envelope view; later signer and stranger are refused", () => {
  const envelope = {
    id: "ENV-1", ownerUid: "owner", senderUid: "sender",
    participantUids: ["owner", "current", "earlier", "later"],
    actionUids: ["owner", "current", "earlier", "later"],
    recipients: [
      { uid: "earlier", status: "Signed" },
      { uid: "current", status: "Pending" },
      { uid: "later", status: "Pending" }
    ],
    fields: [
      { fieldId: "prior", signerUid: "earlier", type: "Signature", applied: true, value: "prior-value" },
      { fieldId: "current", signerUid: "current", type: "Signature", value: "not-yet-applied" },
      { fieldId: "later", signerUid: "later", type: "Signature", value: "future-value" }
    ],
    workflowHistory: [{ uid: "earlier", status: "Signed" }]
  };
  for (const uid of ["owner", "sender", "current", "earlier"]) {
    const result = filterSignatureEnvelopeForCaller(envelope, { authenticatedUid: uid, isAdmin: false });
    assert.equal(result.allowed, true, uid);
    if (uid === "current") {
      assert.equal(result.view.recipients.some(r => r.uid === "later"), false);
      assert.equal(result.view.fields.some(f => f.signerUid === "later"), false);
    }
  }
  assert.equal(filterSignatureEnvelopeForCaller(envelope, { authenticatedUid: "admin", isAdmin: true }).allowed, true);
  assert.equal(filterSignatureEnvelopeForCaller(envelope, { authenticatedUid: "later", isAdmin: false }).allowed, false);
  assert.equal(filterSignatureEnvelopeForCaller(envelope, { authenticatedUid: "stranger", isAdmin: false }).allowed, false);
});
