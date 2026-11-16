import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { requireSupportedSignatureRoutingMode } from "../src/firebase/signatureWorkflowPolicy.js";

const portal = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");

test("Sequential and Parallel are the only supported Signature Portal routing modes", () => {
  assert.equal(requireSupportedSignatureRoutingMode("Sequential"), "Sequential");
  assert.equal(requireSupportedSignatureRoutingMode("Parallel"), "Parallel");
  assert.equal(requireSupportedSignatureRoutingMode(undefined), "Sequential");
});

test("unsupported and malformed routing modes fail closed", () => {
  assert.throws(() => requireSupportedSignatureRoutingMode("Mixed"), /not yet supported/);
  assert.throws(() => requireSupportedSignatureRoutingMode(""), /not yet supported/);
  assert.throws(() => requireSupportedSignatureRoutingMode("parallel"), /not yet supported/);
});

test("Signature Portal signing reads use the scoped download route and preserve envelope identity", () => {
  const platform = fs.readFileSync(new URL("../src/firebase/signaturePlatform.js", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  const storage = fs.readFileSync(new URL("../src/firebase/signatureStorage.js", import.meta.url), "utf8");
  const gateway = fs.readFileSync(new URL("../drive-gateway/src/index.js", import.meta.url), "utf8");

  assert.match(platform, /downloadSignatureBytes/);
  assert.match(platform, /fetchBytes\(envelope\.signedDocumentUrl\|\|envelope\.documentUrl,envelope\.documentId,envelope\.id\)/);
  assert.doesNotMatch(page, /downloadDriveBytes/);
  assert.doesNotMatch(page, /<option>Mixed<\/option>/);
  assert.match(storage, /\/api\/signature-file\/download/);
  assert.match(storage, /metadata\.customMetadata\?\.envelopeId/);
  assert.match(gateway, /url\.pathname === "\/api\/signature-file\/download"/);
  assert.match(gateway, /canReadSignatureAsset/);
});

test("uploaded controlled PDF enters the pre-signing palette with scoped document access", () => {
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  const storage = fs.readFileSync(new URL("../src/firebase/signatureStorage.js", import.meta.url), "utf8");
  assert.match(page, /setDocumentId\(initialDocument\.id\);setDocumentUrl\(url\)/);
  assert.match(page, /setSigningCircle\("Document Selected"\);setTab\("Prepare Envelope"\)/);
  assert.match(page, /import\{[^}]*downloadControlledDocumentBytes,downloadSignatureBytes(?:,resendFailedGatewaySignatureInvitations)?[^}]*\}from"\.\.\/firebase\/signatureStorage"/);
  assert.match(page, /const fileId=String\(url\)\.slice\("drive:\/\/".length\);[\s\S]*?signingStage&&envelopeId\?await downloadSignatureBytes\(fileId,documentId,envelopeId\):await downloadControlledDocumentBytes\(fileId,documentId\)/);
  assert.match(storage, /export async function downloadControlledDocumentBytes\(fileId, documentId\)/);
  assert.match(storage, /if \(!fileId \|\| !documentId\) throw new Error/);
});

test("PDF palette resolves controlled Drive PDFs in archive, initial selection and upload paths", () => {
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  assert.match(page, /function controlledPdfUrl\(document=\{\}\)/);
  assert.match(page, /if\(driveId\)return `drive:\/\/\$\{driveId\}`/);
  assert.match(page, /setDocumentUrl\(controlledPdfUrl\(d\)\)/);
  assert.match(page, /setDocumentUrl\(controlledPdfUrl\(doc\)\)/);
  assert.match(page, /setDocumentUrl\(controlledPdfUrl\(selectedDoc\)\)/);
  assert.match(page, /const url=controlledPdfUrl\(initialDocument\)/);
});


test("Signature Portal palette queries include document owner and signature owner access", () => {
  const data = fs.readFileSync("src/firebase/data.js", "utf8");
  const rules = fs.readFileSync("firestore.rules", "utf8");
  assert.match(data, /where\("ownerUid","==",uid\)/);
  assert.match(data, /where\("signatureOwnerUid","==",uid\)/);
  assert.match(data, /d\?\.driveFileId/);
  assert.match(rules, /resource\.data\.get\("ownerUid",""\)==request\.auth\.uid/);
  assert.match(rules, /resource\.data\.get\("signatureOwnerUid",""\)==request\.auth\.uid/);
});

// Source-contract checks follow the current handler shape, including signerUid ownership and whitespace-safe finally blocks.
test("adding the first signing officer creates a signature field assigned to that officer", () => {
  assert.match(portal, /const nextFields=fields\.map\(f=>\(\["Signature","Initials"\]\.includes\(f\.type\)&&!f\.signerUid\)/);
  assert.match(portal, /if\(!nextFields\.some\(f=>\["Signature","Initials"\]\.includes\(f\.type\)&&f\.signerUid===next\.uid\)\)nextFields\.push\(\{\.\.\.makeField\("Signature",nextFields\.length,next\.uid,preparationPage\),placeholder:"Assigned signature field — click to open your signing pane"\}\)/);
  assert.match(portal, /onPageChange=\{setPreparationPage\}/);
  assert.match(portal, /fields:nextFields/);
  assert.match(portal, /setFields\(nextFields\)/);
});


test("Signature Portal palette includes authenticated Documents Portal lifecycle PDFs", () => {
  const data = fs.readFileSync("src/firebase/data.js", "utf8");
  assert.match(data, /import \{ listLifecycleDocuments \} from "\.\/documentLifecycle\.js"/);
  assert.match(data, /const lifecycle=await listLifecycleDocuments\(\)/);
  assert.match(data, /lifecycle\?\.documents/);
  assert.match(data, /documentId\|\|item\?\.id/);
  assert.match(data, /item\?\.fileUrl\|\|\(fileId\?/);
  assert.ok(data.includes('item?.contentType||item?.mimeType||"application/pdf"'));
  assert.match(data, /d\?\.downloadUrl\|\|d\?\.downloadURL/);
  assert.match(data, /const byId=new Map\(results\.map\(item=>\[String\(item\.id\|\|item\.documentId\),item\]\)\)/);
});


test("archive-backed controlled PDFs remain discoverable and selectable in the Signature Portal palette", () => {
  const data = fs.readFileSync("src/firebase/data.js", "utf8");
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  for (const field of ["archiveFileId", "governanceArchiveFileId", "primaryArchiveFileId", "governanceArchiveFileWebViewLink"]) {
    assert.ok(data.includes(field), `document discovery must recognize ${field}`);
    assert.ok(page.includes(field), `palette URL resolution must recognize ${field}`);
  }
  assert.match(data, /if\(!\(d\?\.fileUrl\|\|d\?\.documentUrl\|\|d\?\.storageUrl\|\|d\?\.pdfUrl\|\|d\?\.downloadUrl\|\|d\?\.downloadURL\|\|driveId\)\)return false/);
  assert.match(page, /function controlledPdfUrl\(document=\{\}\)/);
});


test("Sign a Document initiation resolves the same primary and governance archive sources as the PDF palette", () => {
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  assert.match(page, /async function initiateSigning\(e\)[\s\S]*?const url=controlledPdfUrl\(source\)/);
  assert.match(page, /function controlledPdfUrl\(document=\{\}\)/);
});

test("Signature Portal PDF palette remains legible and reports retrieval failures", () => {
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  assert.match(page, /background:"#111827",color:"#f8fafc"/);
  assert.match(page, /background:"#ffffff"/);
  assert.match(page, /PDF could not be loaded\. Check your access to this controlled document/);
  assert.ok(page.includes('setPdf(null);setPageNum(1);setError("")'));
});


test("signature PDF palette uses controlled-document authorization during Draft preparation and signature-file authorization only in signing stage", () => {
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  assert.ok(page.includes("signingStage=false"));
  assert.ok(page.includes("signingStage&&envelopeId?await downloadSignatureBytes"));
  assert.ok(page.includes('signingStage={tab==="Sign Document"}'));
  const gateway = fs.readFileSync(new URL("../drive-gateway/src/index.js", import.meta.url), "utf8");
  assert.ok(gateway.includes("failedCondition="));
  assert.ok(gateway.includes("Drive.description.documentId="));
  assert.ok(gateway.includes("callerRole="));
});

test("owner signature requirement is separate from explicit signer-field assignment", () => {
  const platform = fs.readFileSync(new URL("../src/firebase/signaturePlatform.js", import.meta.url), "utf8");
  const worker = fs.readFileSync(new URL("../drive-gateway/src/index.js", import.meta.url), "utf8");
  assert.match(portal, /const f=makeField\(type,fields\.length,"",pageNum\)/);
  assert.match(portal, /ownerSigningEnabled\?\[\{\.\.\.documentOwner,optionalSigning:false,actionRequired:true\}\]:\[\]/);
  assert.match(portal, /ownerSigningEnabled&&!fields\.some\(f=>f\?\.type==="Signature"&&f\.required!==false&&f\.signerUid===documentOwner\.uid\)/);
  assert.match(platform, /ownerSigningEnabled=false/);
  assert.match(platform, /ownerSignatureAssigned=.*field\.signerUid===u\.uid/);
  assert.match(worker, /ownerSignatureFields = fields\.filter\(field => field && field\.signerUid === uid && field\.type === "Signature"/);
  assert.match(worker, /An owner Signature field is assigned while the owner signature requirement is disabled/);
  assert.match(worker, /Owner Section Saved/);
  assert.match(worker, /assignedOwnerSignatureFieldIds/);
});
test("mobile Signature Portal keeps the palette and signer-assignment controls visible", () => {
  const css = fs.readFileSync(new URL("../src/styles/signature-portal.css", import.meta.url), "utf8");
  assert.match(portal, /const\[paletteExpanded,setPaletteExpanded\]=useState\(true\)/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(css, /\.signature-workflow-grid > aside/);
  assert.match(portal, /onPageChange=\{setPreparationPage\}/);
});



test("owner signature palette action remains available and explicitly assigns a field to the owner on the current PDF page", () => {
  assert.ok(portal.includes("ownerSigner=null"));
  assert.ok(portal.includes("ownerSigner={ownerSigningEnabled?documentOwner:null}"));
  assert.ok(portal.includes('data-owner-signature-placement="true"'));
  assert.ok(portal.includes("Place Owner Signature — Page {pageNum}"));
  assert.ok(portal.includes('const addOwnerSignatureAt=(x=50,y=20)=>{if(!ownerSigner?.uid)'));
  assert.ok(portal.includes('makeField("Signature",fields.length,ownerSigner.uid,pageNum)'));
  assert.ok(portal.includes("f.required=true"));
  assert.ok(portal.includes("commit([...fields,f]);setSelectedField(f.fieldId)"));
});

test("owner remains selectable for field assignment and each signature field remains bound to its PDF page", () => {
  assert.ok(portal.includes("{recipients.map(r=><option key={r.uid} value={r.uid}>"));
  assert.ok(portal.includes("const pageFields=fields.filter(f=>Number(f.page)===pageNum)"));
  assert.ok(portal.includes('makeField("Signature",fields.length,ownerSigner.uid,pageNum)'));
  assert.ok(portal.includes('ownerSigningEnabled?[{...documentOwner,optionalSigning:false,actionRequired:true}]:[]'));
});

test("signature assignment and signing handlers synchronously reject repeated submissions", () => {
  assert.match(portal, /const addSignerInFlightRef=useRef\(false\),signInFlightRef=useRef\(false\)/);
  const addSigner = portal.match(/async function addSigner\(\)\{([\s\S]*?)(?=\n\s*function removeSigner\()/);
  assert.ok(addSigner, "the signer assignment handler must exist");
  assert.match(addSigner[1], /if\(addSignerInFlightRef\.current\|\|busy\)return/);
  assert.match(addSigner[1], /addSignerInFlightRef\.current=true/);
  assert.match(addSigner[1], /finally\s*\{\s*addSignerInFlightRef\.current=false;\s*setBusy\(false\);?\s*\}/);
  const sign = portal.match(/async function sign\(\)\{([\s\S]*?)(?=\n\s*(?:async )?function |\n\s*return \()/);
  assert.ok(sign, "the signing handler must exist");
  assert.match(sign[1], /if\(signInFlightRef\.current\|\|busy\)return/);
  assert.match(sign[1], /signInFlightRef\.current=true/);
  assert.match(sign[1], /finally\s*\{\s*signInFlightRef\.current=false;\s*setBusy\(false\);?\s*\}/);
});

test("email invitation tokens scope fields to one signer and never expose another saved signature profile", () => {
  const gatewayPortal = fs.readFileSync(new URL("../src/pages/GatewaySigningPortal.jsx", import.meta.url), "utf8");
  const gateway = fs.readFileSync(new URL("../drive-gateway/src/signing.mjs", import.meta.url), "utf8");
  const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

  assert.match(gateway, /signerById=new Map/);
  assert.match(gateway, /signerId:assigned\.id/);
  assert.match(gateway, /f\.signerId===signer\.id/);
  assert.match(gateway, /identityType==="email-link"\) return signer\.emailLinkStatus==="opened"/);
  assert.doesNotMatch(gateway, /ctx\.verifyEmailSignerAuthority|ctx\.verifySigningAuthority/);
  assert.match(app, /<GatewaySigningPortal token=\{emailSigningToken\} emailLink\/>/);
  assert.match(gatewayPortal, /fetchGatewaySigningResource\("\/api\/sign\/email\/open",token\)/);
  assert.match(gatewayPortal, /onClick=\{\(\)=>isSignature\?setSignaturePad\(field\):null\}/);
  assert.match(gatewayPortal, /const assignedAccount=Boolean\(result\.signer\?\.uid&&auth\.currentUser\?\.uid===result\.signer\.uid\)/);
  assert.match(gatewayPortal, /const verifiedProfileOwner=Boolean\(auth\.currentUser\?\.uid&&auth\.currentUser\?\.emailVerified/);
  assert.match(gatewayPortal, /\(assignedAccount\|\|verifiedProfileOwner\)\?await getMySignatureProfile\(\)\.catch\(\(\)=>null\):null/);
  assert.doesNotMatch(gatewayPortal, /verifyManualSigningAuthority|updateMySignerAuthority|manualAuthority/);
  assert.match(rules, /match \/signatureProfiles\/\{uid\}\{allow read:if signatureProfileUser\(\)&&self\(uid\)/);
  assert.doesNotMatch(rules, /match \/signatureProfiles\/\{uid\}\{allow read:if admin\(\)/);
  assert.match(rules, /allow delete:if false/);
});

test("Gateway-linked envelopes cannot fall back to client-side UID signing",()=>{
  const portal=fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx",import.meta.url),"utf8");
  const firebase=fs.readFileSync(new URL("../src/firebase/signaturePlatform.js",import.meta.url),"utf8");
  assert.match(portal,/selected\.gatewayEnvelopeId&&!window\.sessionStorage\.getItem\("irpaGatewaySigningToken"\)/);
  assert.match(firebase,/envelope\?\.gatewayEnvelopeId&&\(typeof window==="undefined"\|\|!window\.sessionStorage\?\.getItem\("irpaGatewaySigningToken"\)\)/);
});

test("email invitations carry owner-assigned PDF fields and permitted action into the Gateway",()=>{
  const storage=fs.readFileSync(new URL("../src/firebase/signatureStorage.js",import.meta.url),"utf8");
  const portal=fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx",import.meta.url),"utf8");
  const signing=fs.readFileSync(new URL("../drive-gateway/src/signing.mjs",import.meta.url),"utf8");
  assert.match(storage,/const signerIdByAssignment\s*=\s*new Map/);
  assert.match(storage,/signerId:\s*signerIdByAssignment\.get/);
  assert.match(storage,/permittedAction:String\(recipient\.permittedAction/);
  assert.match(portal,/fields:env\.fields\|\|\[\]/);
  assert.match(portal,/gatewayRecipients=\[\.\.\.\(ownerSigningEnabled\?/);
  assert.match(signing,/permittedAction,ownerAssignedParticulars/);
  assert.match(signing,/f\.signerId===signer\.id/);
  assert.match(signing,/ownerAssignedParticulars/);
  assert.match(signing,/signerDeclaredParticulars/);
  assert.match(signing,/particularsComparison/);
});

test("account-bound signer access remains restricted to the matching Firebase UID", () => {
  const gateway = fs.readFileSync(new URL("../drive-gateway/src/signing.mjs", import.meta.url), "utf8");
  assert.match(gateway, /return Boolean\(user\?\.uid\)&&user\.uid===signer\.uid/);
  assert.match(gateway, /if\(!signer\?\.uid\) return true/);
  assert.match(gateway, /if\(signer\?\.identityType==="email-link"\) return signer\.emailLinkStatus==="opened"/);
});
