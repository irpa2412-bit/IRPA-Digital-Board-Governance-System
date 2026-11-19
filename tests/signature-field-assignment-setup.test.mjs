import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  SIGNATURE_FIELD_COORDINATE_SPACE,
  signatureFieldFromPercent,
  signatureFieldToPercent,
  signatureFieldToPdfBox
} from "../src/utils/signatureFieldCoordinates.mjs";

const ui=readFileSync(new URL("../src/pages/SignaturePlatform.jsx",import.meta.url),"utf8");
const storage=readFileSync(new URL("../src/firebase/signatureStorage.js",import.meta.url),"utf8");
const emailPage=readFileSync(new URL("../src/pages/EmailSigningReadOnlyPage.jsx",import.meta.url),"utf8");
const platform=readFileSync(new URL("../src/firebase/signaturePlatform.js",import.meta.url),"utf8");
const designer=ui.slice(ui.indexOf("function PDFDesigner"),ui.indexOf("export default function SignaturePlatform"));
const addSigner=ui.slice(ui.indexOf("async function addSigner"),ui.indexOf("function removeSigner"));
const palette=designer.slice(designer.indexOf("PEOPLE & FIELD ASSIGNMENT"),designer.indexOf("FIELDS ON THIS DOCUMENT")+10000);
const savedDraft=platform.slice(platform.indexOf("export async function saveSignatureWorkflowDraft"),platform.indexOf("export async function finalizeSignatureWorkflowDraft"));
const gatewayMapper=storage.slice(storage.indexOf("export async function createGatewaySignatureEnvelope"),storage.indexOf("export async function getGatewaySignatureEnvelopeStatus"));

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const page=(rotation)=>({getCropBox:()=>({x:17,y:23,width:612,height:792}),getRotation:()=>({angle:rotation})});

test("setup screen renders signer choices and keeps the field signer selector enabled",()=>{
  assert.match(designer,/recipients\.map\(r=><option key=\{r\.uid\} value=\{r\.uid\}>/);
  assert.match(designer,/value=\{field\.signerUid\|\|""\} onChange=/);
  assert.doesNotMatch(designer,/select aria-label=\{"Assign "\+field\.type\+" field "\+\(index\+1\)\}[^>]*disabled/);
  assert.match(designer,/setSelectedAssigneeUid\(uid\).*onSelectAssignee\?\.\(uid\)/);
  assert.match(designer,/const f=makeField\(type,fields\.length,selectedAssigneeUid,pageNum\)/);
});

test("adding unregistered people creates independent identities even when their delivery email is shared",()=>{
  assert.match(addSigner,/crypto\.getRandomValues\(new Uint8Array\(16\)\)/);
  assert.match(addSigner,/uid:"email-link-"\+identityKey,identityType:"email-link"/);
  assert.match(addSigner,/const nextRecipients=\[\.\.\.recipients,next\]/);
  assert.doesNotMatch(addSigner,/recipients\.find\([^)]*email[^)]*\)/);
  assert.match(addSigner,/setActiveAssigneeUid\(next\.uid\)/);
});

test("field selection, explicit reassignment and placement preserve the selected signer UID",()=>{
  assert.ok(designer.includes("const selectAssignee=uid=>{setSelectedAssigneeUid(uid);setSelectedRoleAssignmentIndex(0);setPendingFieldType(\"\");onSelectAssignee?.(uid)}"));
  assert.match(designer,/const addAt=\(type,x=50,y=20\)=>/);
  assert.match(designer,/makeField\(type,fields\.length,selectedAssigneeUid,pageNum\)/);
  assert.match(palette,/update\(field\.fieldId,\{signerUid:uid,roleAssignmentIndex:0,responsibility:/);
});

test("save, reload and Gateway mapping preserve unique signer IDs and stored geometry",()=>{
  assert.match(savedDraft,/signatureFieldFromPercent\(\{\.\.\.field,page:Number\(field\?\.page\|\|1\),x:Number\(field\?\.x\?\?10\),y:Number\(field\?\.y\?\?12\),width:Number\(field\?\.width\?\?24\),height:Number\(field\?\.height\?\?9\)\}\)/);
  assert.match(savedDraft,/coordinateSpace:"visible-page-fraction-v1"/);
  assert.match(savedDraft,/fields:signatureFieldsToPercent\(savedDraft\.fields/);
  assert.match(gatewayMapper,/for\(const key of \[recipient\.id,recipient\.signerId,recipient\.uid,recipient\.email\]\)/);
  assert.match(gatewayMapper,/const key=String\(field\?\.signerId\|\|field\?\.signerUid\|\|""\)/);
  assert.match(gatewayMapper,/signerAssignmentByKey\.get\(key\)/);
});

test("three distinct signer identities sharing one email each retain three independent field assignments",()=>{
  const sharedEmail="shared@example.test";
  const recipients=["email-link-person-a","email-link-person-b","email-link-person-c"].map((uid,index)=>({uid,email:sharedEmail,identityType:"email-link",routingOrder:index+1}));
  const fields=recipients.flatMap((recipient,index)=>Array.from({length:3},(_,n)=>({
    fieldId:`person-${index+1}-field-${n+1}`,type:"Signature",page:[1,2,3][n],
    x:12+n*4,y:18+n*5,width:18,height:3.5,signerUid:recipient.uid
  })));
  const assigned=fields.map(field=>({...field,signerUid:recipients.find(r=>r.uid===field.signerUid)?.uid}));
  assert.equal(new Set(recipients.map(r=>r.uid)).size,3);
  assert.equal(new Set(recipients.map(r=>r.email)).size,1);
  assert.equal(assigned.length,9);
  for(const recipient of recipients)assert.equal(assigned.filter(field=>field.signerUid===recipient.uid).length,3);
});

test("an unregistered signer can select their assigned signature field and open the pad",()=>{
  assert.ok(emailPage.includes("setSelectedFieldId(field.fieldId)"));
  assert.ok(emailPage.includes("const field=signaturePadField||selectedField"));
  assert.ok(emailPage.includes("setFieldApplications(current=>[...current.filter(item=>item.fieldId!==field.fieldId),application])"));
  if(emailPage.includes("const shouldShowSignaturePad=Boolean")){
    assert.ok(emailPage.includes('setSelectedFieldId(matchedProfile?(firstAssignedField?.fieldId||""):"")'));
    assert.ok(emailPage.includes('setSignaturePadField(["Signature","Initials"].includes(field.type)?field:null)'));
    assert.ok(emailPage.includes("signaturePadField?.fieldId===selectedField.fieldId"));
  }else{
    assert.ok(emailPage.includes('setSelectedFieldId(firstAssignedField?.fieldId||"")'));
    assert.ok(emailPage.includes("setSignaturePadField(field)"));
  }
});

test("participant button gating and required signer name/email validation are explicit",()=>{
  assert.ok(designer.includes('disabled={busy||(!selectedSigner&&!String(signerEmail||"").trim())}'));
  assert.ok(addSigner.includes('if(!registered&&!email){setMessage("Select a registered officer or enter a signer name and email address.'));
  assert.ok(addSigner.includes('Enter the signer’s full name as well as their email address.'));
  assert.ok(addSigner.includes("valid email address"));
});

const createStart=ui.indexOf("async function createEnvelope(e)");
const createValidation=ui.slice(createStart,ui.indexOf("let env=draftEnvelopeId",createStart));

test("envelope validation rejects duplicate or missing signer UIDs but permits shared email addresses",()=>{
  assert.ok(createValidation.includes('Every participant must have a unique signer identity before the envelope can be created.'));
  assert.ok(createValidation.includes('if(seenSignerUids.has(uid)){duplicateRecipients.push(recipient);continue;}'));
  assert.ok(createValidation.includes('const seenSignerUids=new Set([documentOwner.uid])'));
  assert.ok(!createValidation.includes("seenSignerEmails"));
  assert.ok(!createValidation.includes("Duplicate participants were detected by signer identity or email"));
});

test("each signer needs an assigned field and fields cannot reference unknown signer identities",()=>{
  assert.ok(createValidation.includes('recipientsWithoutFields=orderedRecipients.filter(recipient=>!fields.some(field=>String(field.signerUid||"")===String(recipient.uid||"")))'));
  assert.ok(createValidation.includes("if(recipientsWithoutFields.length)"));
  assert.ok(createValidation.includes("if(fields.some(f=>!f.signerUid||!signerUids.has(f.signerUid)))"));
});

test("owner-signing mode requires a required Signature field assigned to the owner",()=>{
  assert.ok(createValidation.includes('ownerSigningEnabled&&!fields.some(f=>f?.type==="Signature"&&f.required!==false&&f.signerUid===documentOwner.uid)'));
});

test("four visible-page rotations preserve non-zero field geometry and all signer metadata through save/reload",()=>{
  for(const rotation of [0,90,180,270]){
    const original={fieldId:`rotation-${rotation}`,type:"Signature",page:rotation/90+1,x:42.25,y:38.5,width:12.5,height:3.2,signerUid:"email-link-person-b",roleAssignmentIndex:0};
    const stored={...signatureFieldFromPercent(original),coordinateSpace:SIGNATURE_FIELD_COORDINATE_SPACE};
    const restored=signatureFieldToPercent(stored);
    for(const key of ["x","y","width","height"])close(restored[key],original[key]);
    assert.equal(restored.signerUid,original.signerUid);
    assert.equal(restored.page,original.page);
    const box=signatureFieldToPdfBox(page(rotation),stored);
    assert.ok(box.width>0&&box.height>0);
    assert.ok([box.x,box.y,box.width,box.height].every(Number.isFinite));
  }
});
