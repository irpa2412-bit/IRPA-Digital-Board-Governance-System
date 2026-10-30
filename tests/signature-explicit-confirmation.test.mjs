import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const platform = read("../src/pages/SignaturePlatform.jsx");
const gatewayPortal = read("../src/pages/GatewaySigningPortal.jsx");
const pad = read("../src/components/SignatureFieldConfirmationPad.jsx");
const service = read("../src/firebase/signaturePlatform.js");
const storage = read("../src/firebase/signatureStorage.js");
const worker = read("../drive-gateway/src/signing.mjs");
const pdf = read("../drive-gateway/src/pdf.mjs");
const draftWorker = read("../drive-gateway/src/index.js");

test("page load, Add signer, Save and Create Draft never insert a signature image", () => {
  assert.doesNotMatch(platform, /if\(src\)\{setValue\(f,src\);\}/);
  assert.doesNotMatch(gatewayPortal, /nextValues\[field\.fieldId\]=sig/);
  assert.doesNotMatch(gatewayPortal, /nextValues\[field\.fieldId\]=initials/);
  assert.match(platform, /async function addSigner\([\s\S]*?setFields\(nextFields\)/);
  assert.match(service, /fields:\(fields\|\|\[\]\)\.map\(field=>\{/);\n  assert.match(service, /delete prepared\.value;delete prepared\.signatureData;delete prepared\.signatureUrl;delete prepared\.signatureValue/);
  assert.doesNotMatch(pdf, /if\(field\.type==="Signature"&&!value\)value=signer\.signatureValue/);
});

test("tapping an assigned signature field opens Draw, Type and saved-signature choices; Confirm applies it", () => {
  assert.match(platform, /onClick=\{\(\)=>setInkField\(f\)\}/);
  assert.match(gatewayPortal, /onClick=\{\(\)=>isSignature\?setSignaturePad\(field\):null\}/);
  for (const label of ["Draw", "Type", "Use my saved signature", "Confirm"]) assert.ok(pad.includes(label), label);
  assert.match(pad, /onConfirm\(dataUrl\)/);
  assert.match(gatewayPortal, /confirmed:true,page:Number\(field\.page\|\|1\)/);
});

test("each signature application carries the saved page and coordinates and the Worker verifies them", () => {
  assert.match(service, /page:Number\(field\.page\|\|1\),x:Number\(field\.x\?\?0\),y:Number\(field\.y\?\?0\),width:Number\(field\.width\?\?24\),height:Number\(field\.height\?\?9\)/);
  assert.match(worker, /application\.confirmed!==true/);
  assert.match(worker, /submitted!==saved/);
  assert.match(pdf, /originalPages\[Number\(field\.page\|\|1\)-1\]/);
  assert.match(gatewayPortal, /fields\.filter\(field=>Number\(field\.page\|\|1\)===pageNum\)/);
});

test("the Worker refuses unconfirmed and non-assigned signature field applications", () => {
  assert.match(worker, /signatureConfirmed!==true/);
  assert.match(worker, /if\(!field\|\|!\["Signature","Initials"\]\.includes\(field\.type\)\)throw new HttpError\(403/);
  assert.match(worker, /Tap the assigned .*confirm it before signing/);
  assert.match(storage, /fieldApplications,signatureConfirmed/);
});

test("the signing view keeps server-side visibility filtering for later signers", () => {
  assert.match(worker, /fields:\(env\.fields\|\|\[\]\)\.filter\(f=>f\.signerUid===signer\.uid\)/);
  assert.match(gatewayPortal, /const fields=opened\.fields\|\|\[\]/);
});

test("signature confirmation palette stays in document flow below the PDF and closes after explicit action", () => {
  assert.match(pad, /position:"relative"/);
  assert.doesNotMatch(pad, /position:"fixed"|inset:0|zIndex:1000|rgba\(15,23,42,\.78\)/);
  assert.match(pad, /aria-modal="false"/);
  assert.match(pad, /onClick=\{onCancel\}/);
  assert.match(platform, /canvas\.style\.height="auto"/);
  assert.match(platform, /zIndex:5/);
  assert.match(gatewayPortal, /zIndex:5/);
  assert.match(gatewayPortal, /zIndex:6/);
});
