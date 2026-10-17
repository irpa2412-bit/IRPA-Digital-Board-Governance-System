import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const portal = fs.readFileSync("src/pages/SignaturePlatform.jsx", "utf8");
const platform = fs.readFileSync("src/firebase/signaturePlatform.js", "utf8");
const rules = fs.readFileSync("firestore.rules", "utf8");

test("PDF designer receives the active draft envelope context", () => {
  assert.match(portal, /function PDFDesigner\(\{url,documentId,envelopeId=null/);
  assert.match(portal, /<PDFDesigner url=\{documentUrl\} documentId=\{documentId\} envelopeId=\{draftEnvelopeId\}/);
});

test("signer UID linking requires a unique active employee email match", () => {
  assert.match(portal, /employeeUidsByEmail/);
  assert.match(portal, /linkedUids\.length===1/);
  assert.match(portal, /\["active","activated","current"\]/);
  assert.doesNotMatch(portal, /uid:\s*member\.id/);
});

test("draft envelope preserves controlled-document origin without bypassing actual-data gate", () => {
  assert.match(platform, /const sourceDocumentSnap=await getDoc\(doc\(db,"documents",documentId\)\)/);
  assert.match(platform, /recordOrigin,trialData:recordOrigin==="TRIAL"/);
  assert.match(rules, /function actualCreateAllowed\(\)\{return actualDataAccessOpen\(\)\|\|trialDataRecord\(request\.resource\.data\);\}/);
  assert.match(rules, /match \/signatureEnvelopes\/\{id\}.*actualCreateAllowed\(\)/);
});

test("selected signer is visible before saving and the add action is disabled during saves", () => {
  assert.match(portal, /const selectedSignerMember=useMemo\(\(\)=>members\.find\(x=>x\.uid===selectedSigner\)/);
  assert.match(portal, /selectedSignerMember&&!recipients\.some\(r=>r\.uid===selectedSignerMember\.uid\)/);
  assert.match(portal, /Not yet saved to workflow/);
  assert.match(portal, /Click “Add signer \/ next level” to save this officer into the workflow ladder and field-assignment list/);
  assert.match(portal, /disabled=\{busy\|\|\(!selectedSigner&&!signerEmail\)\}/);
  assert.match(portal, /busy\?"Saving signer…":"Add signer \/ next level"/);
});
