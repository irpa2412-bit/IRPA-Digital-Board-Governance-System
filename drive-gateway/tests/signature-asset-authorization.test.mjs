import assert from "node:assert/strict";
import test from "node:test";
import {
  canProvisionSignatureProfileFolder,
  canReadSignatureAsset,
  canUploadSignedDocument,
} from "../src/signatureAssetAuthorization.mjs";

test("Signature Profile folder provisioning is self-only unless the caller is an active admin", () => {
  assert.equal(canProvisionSignatureProfileFolder({
    authenticatedUid: "member-1", requestedUid: "member-1", isAdmin: false,
  }), true);
  assert.equal(canProvisionSignatureProfileFolder({
    authenticatedUid: "member-1", requestedUid: "member-2", isAdmin: false,
  }), false);
  assert.equal(canProvisionSignatureProfileFolder({
    authenticatedUid: "admin-1", requestedUid: "member-2", isAdmin: true,
  }), true);
  assert.equal(canProvisionSignatureProfileFolder({
    authenticatedUid: "member-1", requestedUid: "member-2", isAdmin: "true",
  }), false);
});

test("Signature Profile assets are readable only by their owner", () => {
  assert.equal(canReadSignatureAsset({
    authenticatedUid: "member-1", purpose: "Signature Profile", ownerUid: "member-1",
  }), true);
  assert.equal(canReadSignatureAsset({
    authenticatedUid: "member-2", purpose: "Signature Profile", ownerUid: "member-1", isAdmin: true,
  }), false);
});

test("controlled documents require matching document metadata and document-level authority", () => {
  const base = {
    authenticatedUid: "member-1",
    purpose: "Controlled Documents",
    documentId: "DOC-1",
    metadataDocumentId: "DOC-1",
    authorizedUids: ["member-1"],
  };
  assert.equal(canReadSignatureAsset(base), true);
  assert.equal(canReadSignatureAsset({ ...base, metadataDocumentId: "DOC-2" }), false);
  assert.equal(canReadSignatureAsset({ ...base, authorizedUids: [] }), false);
  assert.equal(canReadSignatureAsset({ ...base, authorizedUids: [], isAdmin: true }), true);
});

test("an assigned envelope participant can read the exact controlled source document", () => {
  const base = {
    authenticatedUid: "signer-1",
    purpose: "Controlled Documents",
    documentId: "DOC-1",
    metadataDocumentId: "DOC-1",
    envelopeId: "ENV-1",
    envelopeDocumentId: "DOC-1",
    envelopeParticipantUids: ["signer-1", "signer-2"],
  };
  assert.equal(canReadSignatureAsset(base), true);
  assert.equal(canReadSignatureAsset({ ...base, envelopeDocumentId: "DOC-2" }), false);
  assert.equal(canReadSignatureAsset({ ...base, envelopeParticipantUids: ["signer-2"] }), false);
  assert.equal(canReadSignatureAsset({ ...base, metadataDocumentId: "DOC-2" }), false);
});

test("signed workflow PDFs require the matching document, envelope, and participant identity", () => {
  const base = {
    authenticatedUid: "signer-1",
    purpose: "Signed Documents Archive",
    documentId: "DOC-1",
    envelopeId: "ENV-1",
    metadataDocumentId: "DOC-1",
    metadataEnvelopeId: "ENV-1",
    envelopeParticipantUids: ["signer-1", "signer-2"],
  };
  assert.equal(canReadSignatureAsset(base), true);
  assert.equal(canReadSignatureAsset({ ...base, metadataEnvelopeId: "ENV-2" }), false);
  assert.equal(canReadSignatureAsset({ ...base, documentId: "DOC-2" }), false);
  assert.equal(canReadSignatureAsset({ ...base, envelopeParticipantUids: ["signer-2"] }), false);
  assert.equal(canReadSignatureAsset({
    ...base,
    metadataDocumentId: "",
    metadataEnvelopeId: "",
    envelopeFileMatches: true,
  }), true, "legacy file access requires an exact match to the envelope's currently referenced file");
  assert.equal(canReadSignatureAsset({
    ...base,
    metadataDocumentId: "",
    metadataEnvelopeId: "",
    envelopeFileMatches: false,
  }), false);
});

test("signed-document upload is restricted to the authenticated assigned action signer", () => {
  const base = {
    authenticatedUid: "signer-1",
    signerUid: "signer-1",
    documentId: "DOC-1",
    envelopeDocumentId: "DOC-1",
    envelopeParticipantUids: ["signer-1", "signer-2"],
    actionUids: ["signer-1", "signer-2"],
    signingMode: "Sequential",
    currentSignerUid: "signer-1",
  };
  assert.equal(canUploadSignedDocument(base), true);
  assert.equal(canUploadSignedDocument({ ...base, signerUid: "signer-2" }), false);
  assert.equal(canUploadSignedDocument({ ...base, currentSignerUid: "signer-2" }), false);
  assert.equal(canUploadSignedDocument({ ...base, envelopeDocumentId: "DOC-2" }), false);
  assert.equal(canUploadSignedDocument({ ...base, actionUids: [] }), false);
  assert.equal(canUploadSignedDocument({ ...base, signingMode: "Parallel", currentSignerUid: null }), true);
  assert.equal(canUploadSignedDocument({ ...base, signingMode: "Direct" }), false);
});
