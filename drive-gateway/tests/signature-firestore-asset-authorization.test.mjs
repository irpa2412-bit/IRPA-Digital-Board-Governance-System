import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { canReadFirestoreSignatureAsset } from "../src/signatureAssetAuthorization.mjs";

const base = {
  authenticatedUid:"owner-1", envelopeExists:true, envelopeDocumentId:"DOC-1",
  requestedDocumentId:"DOC-1", documentRecordExists:true, recordDriveFileId:"DRIVE-1",
  requestedDriveFileId:"DRIVE-1", envelopeOwnerUid:"owner-1", envelopeSenderUid:"owner-1",
  recipients:[{uid:"signer-1",status:"Signed"},{uid:"signer-2",status:"Pending"},{uid:"signer-3",status:"Pending"}],
  currentSignerUid:"signer-2", workflowHistory:[{uid:"signer-1",status:"Signed"}]
};

test("owner and administrator remain authorized when Drive description documentId is mismatched",()=>{
  assert.equal(canReadFirestoreSignatureAsset(base),true);
  assert.equal(canReadFirestoreSignatureAsset({...base,authenticatedUid:"admin-1",isAdmin:true,envelopeOwnerUid:"owner-1"}),true);
  const source=fs.readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
  assert.match(source,/repairSignatureAssetDescription/);
  assert.match(source,/SIGNATURE_ASSET_DESCRIPTION_REPAIRED/);
  assert.match(source,/previousDescriptionDocumentId/);
  assert.match(source,/repairedDescriptionDocumentId/);
});

test("current signer is allowed to read the signature asset",()=>{
  assert.equal(canReadFirestoreSignatureAsset({...base,authenticatedUid:"signer-2"}),true);
});

test("earlier signer is allowed only after completing their turn",()=>{
  assert.equal(canReadFirestoreSignatureAsset({...base,authenticatedUid:"signer-1"}),true);
  assert.equal(canReadFirestoreSignatureAsset({...base,authenticatedUid:"signer-1",workflowHistory:[],recipients:[{uid:"signer-1",status:"Pending"},{uid:"signer-2",status:"Pending"}]}),false);
});

test("later signer and stranger are refused without leaking future assignment data",()=>{
  assert.equal(canReadFirestoreSignatureAsset({...base,authenticatedUid:"signer-3"}),false);
  assert.equal(canReadFirestoreSignatureAsset({...base,authenticatedUid:"stranger"}),false);
});

test("requested Drive file ID must match the documents record",()=>{
  assert.equal(canReadFirestoreSignatureAsset({...base,requestedDriveFileId:"DRIVE-OTHER"}),false);
});

test("envelope and document record identities are required",()=>{
  assert.equal(canReadFirestoreSignatureAsset({...base,envelopeExists:false}),false);
  assert.equal(canReadFirestoreSignatureAsset({...base,envelopeDocumentId:"DOC-OTHER"}),false);
  assert.equal(canReadFirestoreSignatureAsset({...base,documentRecordExists:false}),false);
});
