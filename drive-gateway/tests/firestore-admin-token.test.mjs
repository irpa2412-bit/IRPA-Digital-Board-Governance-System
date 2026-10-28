import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { filterSignatureEnvelopeForCaller } from "../src/signatureWorkflowVisibility.mjs";

const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const lifecycle = await readFile(new URL("../src/documentLifecycle.mjs", import.meta.url), "utf8");

function routeSource(name, nextName) {
  return source.slice(source.indexOf("async function " + name + "("), source.indexOf("async function " + nextName + "("));
}

test("signature asset and completed archive use the Worker admin token", () => {
  const download = routeSource("downloadSignatureFile", "finalizeSignatureProfileArchives");
  const completed = routeSource("finalizeSignatureProfileArchives", "ensureSignatureProfileFolder");
  assert.ok(download.includes("const firestoreAdminToken = await getFirestoreAdminAccessToken(env)"));
  assert.ok(download.includes("getFirestoreDocument(env, \"documents/\" + documentId, firestoreAdminToken)"));
  assert.ok(!download.includes("claims.token"));
  assert.ok(completed.includes("await getFirestoreAdminAccessToken(env)"));
  assert.ok(!completed.includes("claims.token"));
});

test("signing and Drive route helpers do not receive the caller token", () => {
  const names = ["upload", "reconcileSignatureDocumentIds", "controlledDocumentUploadPolicyCheck", "uploadControlledDocument", "download", "downloadSignatureFile", "finalizeSignatureProfileArchives", "ensureSignatureProfileFolder", "provisionDocumentArchive", "ensureSignedDocumentArchive", "deleteDriveFile", "sendSignatureInvitation"];
  for (const name of names) {
    const start = source.indexOf("async function " + name + "(");
    if (start < 0) continue;
    let end = source.indexOf("\nasync function ", start + 10);
    const nextFunction = source.indexOf("\nfunction ", start + 10);
    if (end < 0 || (nextFunction >= 0 && nextFunction < end)) end = nextFunction;
    if (end < 0) end = source.length;
    const route = source.slice(start, end);
    assert.ok(!route.includes("claims.token)"), name + " passes caller token as a positional argument");
    assert.ok(!route.includes("claims.token,"), name + " passes caller token as a positional argument");
  }
  assert.ok(!lifecycle.includes("deps.getFirestoreDocument(env, \"documents/\"+cleanId(documentId), claims.token)"));
  assert.ok(!lifecycle.includes("deps.updateFirestoreDocument(env, \"documents/\"+cleanId(documentId), claims.token"));
  assert.ok(lifecycle.includes("deps.getFirestoreAdminAccessToken(env)"));
});

test("administrator, owner, current and earlier signers retain authorised views; stranger is refused", () => {
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
  for (const uid of ["owner", "sender", "current", "earlier", "later"]) {
    const result = filterSignatureEnvelopeForCaller(envelope, { authenticatedUid: uid, isAdmin: false });
    assert.equal(result.allowed, true, uid);
    if (uid === "current") {
      assert.equal(result.view.recipients.some(r => r.uid === "later"), false);
      assert.equal(result.view.fields.some(f => f.signerUid === "later"), false);
    }
  }
  assert.equal(filterSignatureEnvelopeForCaller(envelope, { authenticatedUid: "admin", isAdmin: true }).allowed, true);
  assert.equal(filterSignatureEnvelopeForCaller(envelope, { authenticatedUid: "stranger", isAdmin: false }).allowed, false);
});
