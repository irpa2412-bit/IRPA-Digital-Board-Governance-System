import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const platform = read("../src/pages/SignaturePlatform.jsx");
const gatewayPortal = read("../src/pages/GatewaySigningPortal.jsx");
const emailLinkPortal = read("../src/pages/EmailSigningReadOnlyPage.jsx");
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

test("email verification and a declared name are the only signer identity gates; title is optional",()=>{
  assert.doesNotMatch(worker,/verifySigningAuthority|verifyEmailSignerAuthority|verifyManualSigningAuthority|Current IRPA Member\/Employee signing authority/);
  assert.match(worker,/if\(!declared\.name\)throw new HttpError\(400/);
  assert.match(worker,/signerDeclarations:declared/);
  assert.doesNotMatch(worker,/declared\.occupation|declared\.capacity|authorityRole/);
  assert.doesNotMatch(gatewayPortal,/Your occupation \*|Additional capacity/);
  assert.doesNotMatch(emailLinkPortal,/Occupation \/ capacity|Additional capacity|authority/);
  assert.match(gatewayPortal,/Title \(optional\)/);
  assert.match(emailLinkPortal,/Title \(optional\)/);
  assert.doesNotMatch(platform,/Current Signing Authority|Participant role \/ action|Verify Authority/);
  assert.match(platform,/Signer title \(optional\)/);
  assert.doesNotMatch(service,/verifyManualSigningAuthority|findManualAuthorityMatch|resolveManualAuthorityLabel/);
});
test("final PDF certificate records owner routing order, declared name, verified email, timeline and hashes",()=>{
  assert.match(certificate,/Position .*routingPosition/);
  assert.match(certificate,/Verified email:/);
  assert.match(certificate,/Invitation:/);
  assert.match(certificate,/Opened:/);
  assert.match(certificate,/Signed:/);
  assert.match(certificate,/Document hash before signing:/);
  assert.match(certificate,/Document hash after signatures \(pre-certificate\):/);
  assert.match(certificate,/sort\(\(a,b\)=>Number\(a\.routingPosition/);
});
test("legacy signing path does not prompt for or verify register authority",()=>{
  assert.doesNotMatch(service,/verifyManualSigningAuthority|findManualAuthorityMatch|resolveManualAuthorityLabel/);
  assert.match(service,/declarations:\{name:String\(profile/);
  assert.doesNotMatch(service,/occupation:String\(manualAuthorityIdentification/);
  assert.doesNotMatch(gatewayPortal,/occupation|capacity/);
});
test("Gateway envelopes route every participant through email-link identity; owner signs only when explicitly enabled",()=>{
  assert.match(storage,/identityType:"email-link"/);
  assert.doesNotMatch(storage,/identityType:emailLink \? "email-link" : "account"/);
  assert.match(storage,/\{\.\.\.\(recipient\.uid \? \{uid:String\(recipient\.uid\)\} : \{\}\)\}/);
  assert.match(platform,/checked=\{ownerSigningEnabled\}/);
  assert.match(platform,/ownerSigningEnabled\?\[\{\.\.\.documentOwner,optionalSigning:false,actionRequired:true\}\]/);
});
test("Gateway field assignment preserves local profile associations without using them as signer identity",()=>{
  assert.match(storage,/recipient\.uid/);
  assert.match(storage,/signerAssignmentByKey/);
  assert.match(storage,/signerId:resolveSignerId\(field\)/);
  assert.match(storage,/identityType:"email-link"/);
  assert.match(storage,/routingPosition:Math\.max/);
});
test("registered profile holders can retain saved signature profiles while invitations remain email-link",()=>{
  assert.doesNotMatch(platform,/identityType:"account"/);
  assert.match(platform,/identityType:"email-link"/);
  assert.match(platform,/gatewayRecipients=workflowRecipients\.map\(recipient=>\(\{\.\.\.recipient,identityType:"email-link"\}\)\)/);
  assert.match(gatewayPortal,/getMySignatureProfile\(\)/);
  assert.match(gatewayPortal,/savedSignatureUrl=\{profile\?\.signatureUrl\|\|""\}/);
  assert.match(gatewayPortal,/onClick=\{\(\)=>isSignature\?setSignaturePad\(field\):null\}/);
});
test("Date fields are presented as server-stamped date and time, not client calendar dates", () => {
  assert.match(platform, /SERVER_TIMESTAMP_PENDING/);
  assert.match(platform, /Gateway server date and time when you submit your signature/);
  assert.match(gatewayPortal, /SERVER_TIMESTAMP_PENDING/);
  assert.match(gatewayPortal, /Gateway server date and time will be recorded on submission/);
});
