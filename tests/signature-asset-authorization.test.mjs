import test from "node:test";
import assert from "node:assert/strict";
import { canReadSignatureAsset } from "../drive-gateway/src/signatureAssetAuthorization.mjs";

const base = {
  purpose: "Signed Documents Archive",
  documentId: "wiAfPSIxHLTd6MdeM04q",
  envelopeId: "draft-envelope-123",
  metadataDocumentId: "wiAfPSIxHLTd6MdeM04q",
  metadataEnvelopeId: "",
  envelopeDocumentId: "wiAfPSIxHLTd6MdeM04q",
  envelopeOwnerUid: "owner-1",
  envelopeSenderUid: "owner-1",
  envelopeParticipantUids: ["participant-1"],
  envelopeActionUids: ["signer-1"],
  envelopeFileMatches: false,
};

test("draft envelope owner can retrieve its source PDF even when asset metadata has no envelope ID", () => {
  assert.equal(canReadSignatureAsset({ ...base, authenticatedUid: "owner-1" }), true);
});

test("envelope participant can retrieve the workflow PDF", () => {
  assert.equal(canReadSignatureAsset({ ...base, authenticatedUid: "participant-1" }), true);
});

test("active administrator can retrieve the workflow PDF", () => {
  assert.equal(canReadSignatureAsset({ ...base, authenticatedUid: "admin-1", isAdmin: true }), true);
});

test("assigned signer is authorized and an unrelated caller is refused", () => {
  assert.equal(canReadSignatureAsset({ ...base, authenticatedUid: "signer-1" }), true);
  assert.equal(canReadSignatureAsset({ ...base, authenticatedUid: "stranger-1" }), false);
});

test("document and envelope identity mismatch remains denied", () => {
  assert.equal(canReadSignatureAsset({ ...base, authenticatedUid: "owner-1", envelopeDocumentId: "different-document" }), false);
});
