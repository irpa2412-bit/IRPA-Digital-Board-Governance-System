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
  assert.match(page, /downloadDriveBytes/);
  assert.match(page, /downloadDriveBytes\(value\.slice\("drive:\/\/".length\)\)/);
  assert.match(page, /downloadSignatureBytes\(fileId,documentId,envelopeId\)/);
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
  assert.match(page, /import\{[^}]*downloadControlledDocumentBytes,downloadDriveBytes,downloadSignatureBytes(?:,resendFailedGatewaySignatureInvitations)?[^}]*\}from"\.\.\/firebase\/signatureStorage"/);
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
test("adding a participant does not auto-place fields or silently reassign existing fields", () => {
  const addSigner = portal.match(/async function addSigner\(\)\{([\s\S]*?)(?=\n function removeSigner\()/);
  assert.ok(addSigner);
  assert.match(addSigner[1], /const nextFields=\[\.\.\.fields\]/);
  assert.doesNotMatch(addSigner[1], /nextFields\.push\(\{\.\.\.makeField/);
  assert.match(addSigner[1], /Choose Signature, Initials or another field tool, then tap the PDF/);
  assert.match(portal, /const f=makeField\(type,fields\.length,selectedAssigneeUid,pageNum\)/);
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
  assert.match(portal, /const f=makeField\(type,fields\.length,selectedAssigneeUid,pageNum\)/);
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
  assert.ok(portal.includes("Select Owner Signature Field"));
  assert.ok(portal.includes('const addOwnerSignatureAt=()=>{if(!pdf||pageError)'));
  assert.ok(portal.includes('if(!ownerSigner?.uid)'));
  assert.ok(portal.includes('selectAssignee(ownerSigner.uid)'));
  assert.ok(portal.includes('setPendingFieldType("Signature")'));
  assert.ok(portal.includes('The document owner already has a Signature field. The existing field is selected.'));
  assert.ok(portal.includes('required:type!=="Checkbox"'));
  assert.ok(portal.includes("commit([...fields,f]);setSelectedField(f.fieldId)"));
});

test("owner remains selectable for field assignment and each signature field remains bound to its PDF page", () => {
  assert.ok(portal.includes("{recipients.map(r=><option key={r.uid} value={r.uid}>"));
  assert.ok(portal.includes("const pageFields=fields.filter(f=>Number(f.page)===pageNum)"));
  assert.ok(portal.includes('selectAssignee(ownerSigner.uid)'));
  assert.ok(portal.includes('setPendingFieldType("Signature")'));
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
  assert.doesNotMatch(sign[1], /signEnvelope\(/, "the in-app account signing fallback must remain unreachable");
  assert.match(sign[1], /This envelope must be signed through its verified email-link invitation/);
  assert.match(sign[1], /if\(!selected\.gatewayEnvelopeId\)\{setMessage\("This draft has not been sent[\s\S]*?return;?\}/, "unsent drafts must be blocked before any in-app signing attempt");
});


test("palette tools support responsive tap-to-place and desktop drag placement", () => {
  const css = fs.readFileSync(new URL("../src/styles/signature-portal.css", import.meta.url), "utf8");
  assert.match(portal, /const\[canDrag,setCanDrag\]=useState\(false\)/);
  assert.match(portal, /window\.matchMedia\("\(pointer:fine\)"\)/);
  assert.match(portal, /draggable=\{canDrag\}/);
  assert.match(portal, /onClick=\{placePendingField\}/);
  assert.match(portal, /aria-pressed=\{pendingFieldType===t\}/);
  assert.match(portal, /Select, then tap PDF/);
  assert.match(css, /\.signature-field-tools\{display:grid/);
  assert.match(css, /@media \(max-width:900px\)/);
  assert.match(css, /@media \(hover:none\)/);
  assert.match(css, /\.signature-pdf-placement-active/);
});

test("participant creation and field assignment are performed inside the PDF palette", () => {
  assert.match(portal, /PEOPLE & FIELD ASSIGNMENT/);
  assert.match(portal, /onAddSigner=\{addSigner\}/);
  assert.match(portal, /onMoveSigner=\{moveSigner\}/);
  assert.match(portal, /onSelectAssignee=\{setActiveAssigneeUid\}/);
  assert.match(portal, /const selectAssignee=uid=>\{setSelectedAssigneeUid\(uid\);setSelectedRoleAssignmentIndex\(0\);setPendingFieldType\("".*?onSelectAssignee\?\.\(uid\)\}/);
  assert.match(portal, /onOwnerSigningChange=\{changeOwnerSigning\}/);
  assert.match(portal, /Assign fields to this person/);
  assert.match(portal, /FIELDS ON THIS DOCUMENT/);
  assert.doesNotMatch(portal, /<h3>Signer Hierarchy<\/h3>/);
  assert.doesNotMatch(portal, /<div className="panel signature-workflow-hierarchy"/);
});

test("duplicate participant identities are reused and rapid repeated add actions are locked before asynchronous work", () => {
  const addSigner = portal.match(/async function addSigner\(\)\{([\s\S]*?)(?=\n function removeSigner\()/);
  assert.ok(addSigner, "the palette participant handler must exist");
  assert.match(addSigner[1], /const duplicate=registered\?recipients\.find\(x=>x\.uid===registered\.uid\):null/);
  assert.match(addSigner[1], /Random per-participant key/);
  assert.doesNotMatch(addSigner[1], /emailHash\.slice\(0,24\)/);
  assert.match(addSigner[1], /const existingAssignments=Array\.isArray\(duplicate\.roleAssignments\)/);
  assert.match(addSigner[1], /const sameAssignment=existingAssignments\.some/);
  assert.match(addSigner[1], /The existing responsibility was selected; no duplicate was created/);
  assert.match(addSigner[1], /roleAssignments:\[\.\.\.existingAssignments,assignment\]/);
  assert.match(addSigner[1], /One email-link identity and invitation covers the responsibilities/);
  assert.ok(addSigner[1].indexOf("addSignerInFlightRef.current=true") < addSigner[1].indexOf("crypto.getRandomValues"));
  assert.ok(addSigner[1].includes('if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))'));
  assert.ok(addSigner[1].includes('if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(registeredEmail))'));
  assert.ok(addSigner[1].includes("email:registeredEmail,role,"));
  assert.match(addSigner[1], /const nextFields=\[\.\.\.fields\]/);
  assert.doesNotMatch(addSigner[1], /fields\.map\(f=>\(\["Signature","Initials"\]\.includes\(f\.type\)&&!f\.signerUid\)/);
});


test("envelope creation requires every participant to have at least one explicitly assigned field", () => {
  assert.match(portal, /if\(!orderedRecipients\.length&&!ownerSigningEnabled\)/);
  assert.ok(portal.includes("const recipientsWithoutFields=orderedRecipients.filter(recipient=>!fields.some(field=>String(field.signerUid"));
  assert.match(portal, /Each participant needs at least one PDF field assigned to their own signer identity/);
  assert.match(portal, /matching fields:/);
});


test("owner identity is never added as a duplicate signer and reorder controls exclude the owner row", () => {
  const addSigner = portal.match(/async function addSigner\(\)\{([\s\S]*?)(?=\n function removeSigner\()/);
  assert.ok(addSigner);
  assert.match(addSigner[1], /const isOwnerDuplicate=!!\(registered&&registered\.uid===documentOwner\.uid\)/);
  assert.doesNotMatch(addSigner[1], /ownerEmail/);
  assert.match(addSigner[1], /setOwnerSigningEnabled\(true\)/);
  assert.match(portal, /const signerRecipients=recipients\.filter\(r=>r\.uid!==ownerSigner\?\.uid\)/);
  assert.match(portal, /disabled=\{signerIndex===0\}/);
  assert.match(portal, /disabled=\{signerIndex===signerRecipients\.length-1\}/);
});


test("envelope creation blocks duplicate participant UIDs but permits shared delivery emails", () => {
  assert.match(portal, /const seenSignerUids=new Set\(\[documentOwner\.uid\]\)/);
  assert.doesNotMatch(portal, /seenSignerEmails/);
  assert.match(portal, /if\(seenSignerUids\.has\(uid\)\)/);
  assert.match(portal, /Duplicate signer identities were detected/);
});

test("document owner can save and close preparation before all fields are assigned, then resume the draft",()=>{
  assert.match(portal,/async function saveAndClosePreparation\(\)/);
  assert.match(portal,/saveSignatureWorkflowDraft\(\{envelopeId:draftEnvelopeId/);
  assert.match(portal,/Save Draft & Close Preparation/);
  assert.match(portal,/Continue Preparation/);
  assert.match(portal,/The draft remains inactive; no signer invitations were sent/);
});

test("Sign a Document is available to every active Signature Profile holder, not owner-only",()=>{
  assert.match(portal,/\["Profile","Sign a Document","Envelopes","Document Tracking","My Documents","Signature Pathway Self-Test"\]/);
  assert.match(portal,/An active Signature Profile is required before starting a signing document/);
  assert.doesNotMatch(portal,/documentOwner\.uid===auth\.currentUser\?\.uid[^\n]*Sign a Document/);
});


test("refreshing an envelope uses one authoritative status read and keeps signer delivery controls visible", () => {
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  const storage = fs.readFileSync(new URL("../src/firebase/signatureStorage.js", import.meta.url), "utf8");
  const refreshStart=page.indexOf(" async function refreshGatewayEmailStatus(){");
  const refreshEnd=page.indexOf(" async function resendEmailLink",refreshStart);
  assert.ok(refreshStart>=0&&refreshEnd>refreshStart);
  const refresh=page.slice(refreshStart,refreshEnd);
  assert.ok(refresh.includes("getGatewaySignatureEnvelopeStatus(selected.gatewayEnvelopeId)"));
  assert.equal(refresh.includes("getGatewaySignatureEnvelopeDeliveryStatus"),false);
  assert.equal(page.includes("getGatewaySignatureEnvelopeDeliveryStatus"),false);
  assert.doesNotMatch(storage,/export async function getGatewaySignatureEnvelopeDeliveryStatus/);
  assert.ok(page.includes("onClick={refreshGatewayEmailStatus}"));
  assert.ok(page.includes("onClick={()=>resendEmailLink(item.id)}"));
  assert.ok(page.includes('Invitation: {item.invitation||"Unknown"} · Link: {item.linkExpired?"Expired":item.emailLinkStatus||"—"}'));
  assert.ok(page.includes(">Send new link</button>"));
  assert.ok(page.includes('color:"var(--text)",opacity:1'));
});

test("new envelopes remain inactive drafts until Start Workflow sends Gateway email-link invitations", () => {
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  const storage = fs.readFileSync(new URL("../src/firebase/signaturePlatform.js", import.meta.url), "utf8");
  const create = page.match(/async function createEnvelope\(e\)\{([\s\S]*?)(?=\n async function saveAndClosePreparation\()/);
  assert.ok(create, "the envelope creation handler must exist");
  assert.doesNotMatch(create[1], /createGatewaySignatureEnvelope|attachGatewayEmailLinkEnvelope/);
  assert.match(create[1], /Draft envelope saved\. No invitations have been sent/);
  const start = storage.match(/export async function startSignatureWorkflow\(envelope\)\{([\s\S]*?)(?=\nexport async function)/);
  assert.ok(start, "the authenticated workflow start handler must exist");
  assert.match(start[1], /createGatewaySignatureEnvelope\(\{envelope,sourceBytes\}\)/);
  assert.doesNotMatch(start[1], /if\(CRYPTOGRAPHIC_GATEWAY_BRIDGE_ENABLED\)/);
  assert.match(page, /if\(!selected\.gatewayEnvelopeId\)\{setMessage\("This draft has not been sent/);
  assert.match(page, /This envelope must be signed through its verified email-link invitation/);
  const signingAction = page.match(/async function sign\(\)\{([\s\S]*?)\n \}/);
  assert.ok(signingAction, "the Sign Document action must exist");
  assert.doesNotMatch(signingAction[1], /signEnvelope\(/, "the account-based client signing fallback must not be reachable");
});

test("owner-first portal signing survives both direct envelope creation and draft preparation",()=>{
  const platform=fs.readFileSync(new URL("../src/firebase/signaturePlatform.js",import.meta.url),"utf8");
  const storage=fs.readFileSync(new URL("../src/firebase/signatureStorage.js",import.meta.url),"utf8");
  assert.match(platform,/ownerSigningEnabled:ownerSigningEnabled===true/);
  assert.match(platform,/ownerSigningEnabled\?u\.uid:/);
  assert.match(storage,/ownerPreSignEmail:String\(ownerSigner\.email\|\|""\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(storage,/ownerSigningToken/);
  assert.match(portal,/if\(updated\.ownerSigningToken\)\{window\.location\.assign\("\/\?emailSignToken="/);
  assert.match(portal,/Owner Sign in Portal & Release Signers/);
  assert.match(portal,/if\(ownerSigningEnabled\)\{[\s\S]*?startSignatureWorkflow\(env\)[\s\S]*?window\.location\.assign\("\/\?emailSignToken="/);
  assert.match(portal,/Save & Open Owner Signature Portal/);
});

test("Title is a real signer-assigned PDF field and Document Tracking shows holder and last action",()=>{
  const platform=fs.readFileSync(new URL("../src/firebase/signaturePlatform.js",import.meta.url),"utf8");
  const worker=fs.readFileSync(new URL("../drive-gateway/src/signing.mjs",import.meta.url),"utf8");
  const signingPortal=fs.readFileSync(new URL("../src/pages/GatewaySigningPortal.jsx",import.meta.url),"utf8");
  const emailSigningPortal=fs.readFileSync(new URL("../src/pages/EmailSigningReadOnlyPage.jsx",import.meta.url),"utf8");
  assert.match(portal,/Title:"Title"/);
  assert.match(portal,/TYPES\.slice\(0,6\)/);
  assert.match(portal,/data-testid="palette-signer-management"/);
  assert.match(platform,/field\.type==="Title"/);
  assert.match(worker,/"Name","Title"/);
  assert.match(worker,/title:signer\.title\|\|""/);
  assert.match(signingPortal,/field\.type==="Title"\)nextValues\[field\.fieldId\]=result\.signer\?\.title/);
  assert.match(emailSigningPortal,/field\.type==="Title"\)initialFieldValues\[field\.fieldId\]=metadata\.ownerDeclaredParticulars\?\.title/);
  assert.match(portal,/Document Tracking Register/);
  assert.match(portal,/CURRENT HOLDER/);
  assert.match(portal,/activeHolders=currentNames\.filter/);
  assert.match(portal,/waitingInvitations=currentNames\.filter/);
  assert.match(portal,/LAST RECORDED ACTION/);
  assert.match(portal,/NEXT EXPECTED ACTION/);
  assert.match(worker,/lastEvent/);
});

test("email-link signers may confirm only their own active saved profile specimen, with drawing fallback",()=>{
  const emailPortal=fs.readFileSync(new URL("../src/pages/EmailSigningReadOnlyPage.jsx",import.meta.url),"utf8");
  const confirmationPad=fs.readFileSync(new URL("../src/components/SignatureFieldConfirmationPad.jsx",import.meta.url),"utf8");
  assert.match(emailPortal,/getMySignatureProfile/);
  assert.match(emailPortal,/String\(currentUser\.email\|\|""\)\.trim\(\)\.toLowerCase\(\)===invitedEmail/);
  assert.match(emailPortal,/candidate\?\.uid===currentUser\.uid/);
  assert.match(emailPortal,/candidate\.status==="Active"/);
  assert.match(emailPortal,/setSignaturePadField\(field\)/);
  assert.match(emailPortal,/savedSignatureUrl=\{savedProfile\?\.signatureUrl\|\|""\}/);
  assert.match(emailPortal,/allowTyped=\{false\}/);
  assert.match(emailPortal,/Your own saved Signature Profile specimen has been confirmed/);
  assert.match(emailPortal,/Your hand-drawn specimen has been confirmed/);
  assert.ok(emailPortal.includes('setSignaturePadField(null);setSelectedFieldId("");'));
  assert.match(confirmationPad,/useState\(hasSavedSpecimen\?"Use my saved signature":"Draw"\)/);
  assert.match(confirmationPad,/Nothing is stamped until you tap Confirm/);
});


test("envelope refresh keeps signer rows readable and separates invitation delivery from link redemption", () => {
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  const refreshStart=page.indexOf(" async function refreshGatewayEmailStatus(){");
  const refreshEnd=page.indexOf(" async function resendEmailLink",refreshStart);
  assert.ok(refreshStart>=0&&refreshEnd>refreshStart,"the envelope delivery refresh handler must exist");
  const refresh=page.slice(refreshStart,refreshEnd);
  assert.ok(refresh.includes("getGatewaySignatureEnvelopeStatus(selected.gatewayEnvelopeId)"));
  assert.equal(refresh.includes("getGatewaySignatureEnvelopeDeliveryStatus"),false);
  assert.ok(refresh.includes("Array.isArray(status.signers)"));
  assert.ok(refresh.includes("last readable list has been preserved"));
  assert.ok(page.includes('Invitation: {item.invitation||"Unknown"} · Link: {item.linkExpired?"Expired":item.emailLinkStatus||"—"}'));
  assert.ok(page.includes(">Send new link</button>"));
  assert.ok(page.includes('aria-busy={gatewayEmailStatusBusy?"true":"false"}'));
  assert.ok(refresh.includes('envelopeId:selected.gatewayEnvelopeId'), "the selected envelope ID must be attached locally even when the Gateway omits it");
  assert.ok(page.includes('className="page signature-portal-root"'));
  assert.ok(page.includes('className="panel signature-envelope-status"'));
  assert.ok(page.includes('.signature-portal-root [aria-busy="true"]'));
  assert.ok(page.includes("opacity: 1;"));
  assert.ok(page.includes('color:"var(--text)",opacity:1'));
});

test("completed-document distribution retry is admitted by the Gateway e-signature route allowlist", () => {
  const worker = fs.readFileSync(new URL("../drive-gateway/src/index.js", import.meta.url), "utf8");
  assert.ok(worker.includes("distribution\\/retry"), "the Worker must route distribution retries into the e-signature router");
});


test("saved signature drafts return canonical persisted fields in preparation-editor percentage coordinates", () => {
  const platform = fs.readFileSync(new URL("../src/firebase/signaturePlatform.js", import.meta.url), "utf8");
  const save = platform.slice(platform.indexOf("export async function saveSignatureWorkflowDraft("), platform.indexOf("\nexport async function finalizeSignatureWorkflowDraft"));
  assert.match(platform, /signatureFieldsToPercent/);
  assert.match(save, /const savedDraft=result\.draft\|\|workerDraft;return\{id,\.\.\.savedDraft,fields:signatureFieldsToPercent\(savedDraft\.fields/);
});

test("owner Signature Profile assets use owner-authorized Drive download, not envelope-scoped signer download", () => {
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  const storage = fs.readFileSync(new URL("../src/firebase/signatureStorage.js", import.meta.url), "utf8");
  const gateway = fs.readFileSync(new URL("../drive-gateway/src/index.js", import.meta.url), "utf8");
  assert.match(page, /downloadDriveBytes\(value\.slice\("drive:\/\/".length\)\)/);
  assert.match(storage, /export async function downloadDriveBytes\(fileId, documentId = null\)/);
  assert.match(gateway, /description\.purpose === "Signature Profile" && description\.ownerUid !== claims\.user_id/);
  assert.match(page, /signingStage&&envelopeId\?await downloadSignatureBytes\(fileId,documentId,envelopeId\)/);
});

test("Prepare Envelope submission is a separate sticky control outside the PDF navigator", () => {
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  const start = page.indexOf('<form onSubmit={createEnvelope} noValidate>');
  const controls = page.indexOf('data-testid="envelope-submit-controls"', start);
  const designer = page.indexOf("<PDFDesigner", start);
  assert.ok(start >= 0 && controls > start && designer > controls);
  assert.match(page.slice(controls, designer), /position:"sticky"/);
  assert.match(page.slice(controls, designer), /type="submit"/);
  assert.match(page.slice(controls, designer), /Independent of PDF navigation/);
  assert.doesNotMatch(page.slice(designer, page.indexOf("</form>", designer)), /type="submit"/);
});
