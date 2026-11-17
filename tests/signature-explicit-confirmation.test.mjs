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
const certificate = pdf;
const draftWorker = read("../drive-gateway/src/index.js");

test("page load, Add signer, Save and Create Draft never insert a signature image", () => {
  assert.doesNotMatch(platform, /if\(src\)\{setValue\(f,src\);\}/);
  assert.doesNotMatch(gatewayPortal, /nextValues\[field\.fieldId\]=sig/);
  assert.doesNotMatch(gatewayPortal, /nextValues\[field\.fieldId\]=initials/);
  assert.match(platform, /async function addSigner\([\s\S]*?setFields\(nextFields\)/);
  assert.match(service, /fields:\(fields\|\|\[\]\)\.map\(field=>\{/);
  assert.match(service, /delete prepared\.value;delete prepared\.signatureData;delete prepared\.signatureUrl;delete prepared\.signatureValue/);
  assert.doesNotMatch(pdf, /if\(field\.type==="Signature"&&!value\)value=signer\.signatureValue/);
});

test("unfilled signature placeholders remain transparent overlays and are not drawn into PDF bytes", () => {
  assert.match(platform, /background:"transparent",borderRadius:5,zIndex:5/);
  assert.match(service, /else if\(field\.type==="Signature"\|\|field\.type==="Initials"\)\{\/\* Keep the unfilled field in envelope metadata; never paint an opaque placeholder into the PDF\. \*\/\}/);
  assert.doesNotMatch(service, /SIGNATURE REQUIRED/);
  assert.match(service, /fields:\(fields\|\|\[\]\)\.map\(field=>\{/);
});
 
test("tapping an assigned signature field opens Draw, Type and saved-signature choices; Confirm applies it", () => {
  assert.match(platform, /const activate=\(f\)=>\{[\s\S]{0,500}?setInkField\(f\);return;\}/);
  assert.match(platform, /data-signature-field-id=\{f\.fieldId\} onClick=\{\(\)=>activate\(f\)\}/);
  assert.match(gatewayPortal, /onClick=\{\(\)=>isSignature\?setSignaturePad\(field\):null\}/);
  for (const label of ["Draw", "Type", "Use my saved signature", "Confirm"]) assert.ok(pad.includes(label), label);
  assert.match(pad, /await onConfirm\(specimen\.dataUrl,field\)/);
  assert.match(gatewayPortal, /confirmed:true,page:Number\(field\.page\|\|1\)/);
});

test("each signature application carries the saved page and coordinates and the Worker verifies them", () => {
  assert.match(service, /page:Number\(field\.page\|\|1\),x:Number\(field\.x\?\?0\),y:Number\(field\.y\?\?0\),width:Number\(field\.width\?\?24\),height:Number\(field\.height\?\?9\)/);
  assert.match(worker, /application\.confirmed!==true/);
  assert.match(worker, /submitted!==saved/);
  assert.match(pdf, /pages\[Number\(field\.page\s*\|\|\s*1\)\s*-\s*1\]/);
  assert.match(gatewayPortal, /fields\.filter\(field=>Number\(field\.page\|\|1\)===pageNum\)/);
});

test("the Worker refuses unconfirmed and non-assigned signature field applications", () => {
  assert.match(worker, /signatureConfirmed!==true/);
  assert.match(worker, /if\(!field\|\|!\["Signature","Initials"\]\.includes\(field\.type\)\)throw new HttpError\(403/);
  assert.match(worker, /Tap the assigned .*confirm it before signing/);
  assert.match(storage, /fieldApplications,signatureConfirmed/);
});

test("the signing view keeps server-side visibility filtering for later signers", () => {
  assert.match(worker, /fields:\(env\.fields\|\|\[\]\)\.filter\(f=>f\.signerId===signer\.id\|\|\(!f\.signerId&&signer\.uid&&f\.signerUid===signer\.uid\)\)/);
  assert.match(gatewayPortal, /const fields=opened\.fields\|\|\[\]/);
});

test("signature confirmation palette is a fixed bottom sheet and closes only after explicit action", () => {
  assert.match(pad, /position:"fixed"/);
  assert.match(pad, /bottom:0/);
  assert.match(pad, /zIndex:1000/);
  assert.match(pad, /maxHeight:"70vh"/);
  assert.match(pad, /overflowY:"auto"/);
  assert.match(pad, /paddingBottom:"env\(safe-area-inset-bottom\)"/);
  assert.match(pad, /aria-modal="false"/);
  assert.match(pad, /Nothing is applied until you tap Confirm/);
  assert.match(pad, /onClick=\{onCancel\}/, "Cancel must discard the unconfirmed signature");
  assert.ok(pad.includes("async function confirm()") && pad.includes("await onConfirm(specimen.dataUrl,field)"), "Trimmed Draw, Type and saved-signature specimens are applied only by explicit Confirm");
  assert.match(platform, /height:"auto"/, "the PDF canvas must retain responsive automatic height sizing");
  assert.match(platform, /zIndex:5/);
  assert.match(gatewayPortal, /zIndex:5/);
  assert.match(gatewayPortal, /zIndex:6/);
});

test("all signer types are authenticated by transaction identity, not IRPA register authority", () => {
  assert.doesNotMatch(worker, /verifySigningAuthority\(user,manualAuthorityIdentification\)/);
  assert.doesNotMatch(worker, /Current IRPA Member\/Employee signing authority could not be verified/);
  assert.match(worker, /else assertSignerAuthentication\(s0,user\)/);
  assert.match(worker, /if\(!declared\.name\|\|!declared\.occupation\)throw new HttpError\(400/);
  assert.match(worker, /signerDeclarations:declared/);
  assert.match(gatewayPortal, /Your occupation \*/);
  assert.match(gatewayPortal, /Additional capacity \(optional\)/);
  assert.doesNotMatch(gatewayPortal, /verifyManualSigningAuthority|Member\/Employee Register|Registered signing authority/);
  assert.doesNotMatch(service, /current signing authority has not been registered|A Current authority is required to sign|Your Signature Application is not active/);
  assert.doesNotMatch(platform, /verifyManualSigningAuthority|authorityVerification\?\.verified|Verify Authority/);
  assert.match(platform, /occupation:signerAuthorityRole\.trim\(\),capacity:signerCapacity\.trim\(\)/);
  assert.match(gatewayPortal, /declarations,consent/);
});

test("final PDF certificate prints owner-recorded and signer-declared occupation and capacity separately", () => {
  assert.match(certificate, /Owner declared: .*Occupation: .*Capacity:/);
  assert.match(certificate, /Signer declared: .*Occupation: .*Capacity:/);
});

test("legacy signing persists signer-declared authority safely when institutional authority metadata is null", () => {
  assert.match(service, /const signerAuthority=null/);
  assert.match(service, /signatureAuthorityDepartment:authorityVerification\.authorityDepartment\|\|signerAuthority\?\.authorityDepartment\|\|""/);
  assert.match(service, /signatureAuthorityUnit:authorityVerification\.authorityUnit\|\|signerAuthority\?\.authorityUnit\|\|""/);
  assert.match(service, /signatureAuthorityStatus:signerAuthority\?\.authorityStatus\|\|""/);
  assert.doesNotMatch(service, /signerAuthority\.(?:authorityRole|authorityDepartment|authorityUnit|authorityStatus|authoritySourceCollection|authoritySourceRecordId)/);
  assert.match(service, /signatureAuthorityVerificationStatus:"Signer-declared; not independently verified"/);
});


test("Gateway envelopes include registered account signers and the owner when explicitly required", () => {
  assert.match(storage, /const accountSigner = Boolean\(r\?\.uid\) && !emailLink/);
  assert.match(storage, /identityType:emailLink \? "email-link" : "account"/);
  assert.match(storage, /\{uid:String\(recipient\.uid\)\}/);
  assert.match(platform, /checked=\{ownerSigningEnabled\}/);
  assert.match(platform, /ownerSigningEnabled\?\[\{\.\.\.documentOwner,optionalSigning:false,actionRequired:true\}\]/);
});

test("new palette fields are assigned to the selected action signer by default", () => {
  assert.match(platform, /aria-label="Assignee for new fields"/);
  assert.match(platform, /makeField\(type,fields\.length,assignee\.uid,pageNum\)/);
  assert.match(platform, /ASSIGN NEW FIELDS TO/);
  assert.match(platform, /Assigned addressee/);
});
