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

test("participant selection and addition are performed directly in the PDF palette", () => {
  assert.match(portal, /PEOPLE & FIELD ASSIGNMENT/);
  assert.match(portal, /onAddSigner=\{addSigner\}/);
  assert.match(portal, /Assign fields to this person/);
  assert.match(portal, /disabled=\{busy\|\|\(!selectedSigner&&!String\(signerEmail\|\|""\)\.trim\(\)\)\}/);
  assert.match(portal, /const duplicate=recipients\.find/);
  assert.match(portal, /The existing signer record has been selected; no duplicate was created/);
  assert.match(portal, /addSignerInFlightRef\.current=true/);
  assert.match(portal, /window\.matchMedia\("\(pointer:fine\)"\)/);
});


test("each PDF field can be assigned both a signer and that signer's specific duty without changing signing protocols", () => {
  assert.match(portal, /Assigned signer<select aria-label=\{"Assign "\+field\.type\+" field "\+\(index\+1\)\}/);
  assert.match(portal, /Assigned duty \/ responsibility<select aria-label=\{"Duty for "\+field\.type\+" field "\+\(index\+1\)\}/);
  assert.match(portal, /roleAssignmentIndex:nextIndex,responsibility:assignment\?\.role\|\|"Review"/);
  assert.match(portal, /const assignments=assignedRecipient\?\(Array\.isArray\(assignedRecipient\.roleAssignments\)/);
  const worker = fs.readFileSync("drive-gateway/src/signing.mjs", "utf8");
  assert.match(worker, /roleAssignmentIndex=f\?\.roleAssignmentIndex==null\?0:Number\(f\.roleAssignmentIndex\)/);
  assert.match(worker, /roleAssignmentIndex>=Math\.max\(1,Array\.isArray\(assigned\.roleAssignments\)\?assigned\.roleAssignments\.length:1\)/);
});

test("PDF placement handler imports its canonical pointer-coordinate helper", () => {
  assert.match(portal, /import\{signatureFieldFromPointer\}from"\.\.\/utils\/signatureFieldCoordinates\.mjs";/);
  assert.match(portal, /const placePendingField=e=>\{[\s\S]*?signatureFieldFromPointer\(e\.clientX,e\.clientY,rect\)/);
  assert.match(portal, /const addAt=\(type,x=50,y=20\)=>\{/);
});
