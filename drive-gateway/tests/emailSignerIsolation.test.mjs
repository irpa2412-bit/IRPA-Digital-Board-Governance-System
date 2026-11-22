import test from "node:test";
import assert from "node:assert/strict";
import { canAuthenticatedSignerAccess, validateEnvelopeFields, validateFieldValues, openSigning, getSigningEvidence, chainEvents } from "../src/signing.mjs";
import { exportPublicKeyJwk, createCryptographicEvidence } from "../src/cryptographicGate.mjs";
import { sha256Hex } from "../src/util.mjs";

const externalSigner = {
  id: "S1",
  email: "vendor@example.org",
  identityType: "email-link",
  emailLinkStatus: "opened",
  status: "Pending",
};
const otherSigner = {
  id: "S2",
  email: "reviewer@example.org",
  identityType: "email-link",
  emailLinkStatus: "opened",
  status: "Pending",
};

test("email-link access is bound to the opened invitation, not an arbitrary unauthenticated caller", () => {
  assert.equal(canAuthenticatedSignerAccess(externalSigner, null), true);
  assert.equal(canAuthenticatedSignerAccess({ ...externalSigner, emailLinkStatus: "issued" }, null), false);
  assert.equal(canAuthenticatedSignerAccess({ ...externalSigner, emailLinkStatus: "revoked" }, null), false);
  assert.equal(canAuthenticatedSignerAccess({ id: "S3", identityType: "legacy-token" }, null), false);
});

test("legacy UID access remains bound to the matching UID", () => {
  const signer = { id: "S1", uid: "uid-1", identityType: "account" };
  assert.equal(canAuthenticatedSignerAccess(signer, { uid: "uid-1" }), true);
  assert.equal(canAuthenticatedSignerAccess(signer, { uid: "uid-2" }), false);
  assert.equal(canAuthenticatedSignerAccess(signer, null), false);
});

test("field assignments bind to signer ID without requiring a Firebase UID", () => {
  const fields = validateEnvelopeFields([
    { fieldId: "vendor-name", signerId: "S1", type: "Name", page: 1 },
    { fieldId: "reviewer-comment", signerId: "S2", type: "Comment", page: 1 },
  ], [externalSigner, otherSigner]);
  assert.equal(fields[0].signerId, "S1");
  assert.equal(fields[0].signerUid, null);
  assert.equal(fields[1].signerId, "S2");
});

test("a field cannot be rebound to a different or unknown signer", () => {
  assert.throws(() => validateEnvelopeFields([
    { fieldId: "private-signature", signerId: "S9", type: "Signature", page: 1 },
  ], [externalSigner, otherSigner]), /invalid or assigned/);
});

test("email-link signer cannot submit another signer's assigned field values", () => {
  const fields = validateEnvelopeFields([
    { fieldId: "vendor-name", signerId: "S1", type: "Name", page: 1, required: true },
    { fieldId: "reviewer-comment", signerId: "S2", type: "Comment", page: 1, required: true },
  ], [externalSigner, otherSigner]);
  const values = validateFieldValues(fields, externalSigner, { "vendor-name": "Vendor" }, { type: "typed", value: "Vendor" }, []);
  assert.deepEqual(values, { "vendor-name": "Vendor" });
  const attempted = validateFieldValues(fields, externalSigner, { "vendor-name": "Vendor", "reviewer-comment": "Private" }, { type: "typed", value: "Vendor" }, []);
  assert.deepEqual(attempted, { "vendor-name": "Vendor" });
  assert.equal(JSON.stringify(attempted).includes("Private"), false);
});


test("email invitation can retrieve only its own cryptographic evidence, never another signer's evidence",async()=>{
  const secret="c".repeat(64),otherSecret="d".repeat(64);
  const signer={...externalSigner,tokenHash:await sha256Hex(secret),emailHash:"1".repeat(64),emailLinkExpiresAt:"2099-01-01T00:00:00.000Z"};
  const reviewer={...otherSigner,tokenHash:await sha256Hex(otherSecret),emailHash:"2".repeat(64),emailLinkExpiresAt:"2099-01-01T00:00:00.000Z"};
  const envelopeId="ENV-evidence-isolation",documentHash="f".repeat(64);
  const events=await chainEvents([],{type:"envelope.created",at:"2026-11-16T14:00:00.000Z"});
  async function evidenceFor(identity){
    const pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
    return createCryptographicEvidence({
      keyId:"KEY-"+identity.id,
      signer:{uid:null,identityType:"email-link",emailHash:identity.emailHash,signerId:identity.id,envelopeId,signatureHash:await sha256Hex("signature-"+identity.id),signatureType:"typed",privateKey:pair.privateKey,publicKey:pair.publicKey},
      documentHash,chainHead:events.at(-1).hash,signedAt:"2026-11-16T14:01:00.000Z",
      publicKeyJwk:await exportPublicKeyJwk(pair.publicKey),
    });
  }
  const ownEvidence=await evidenceFor(signer),otherEvidence=await evidenceFor(reviewer);
  const envelope={id:envelopeId,documentId:"DOC-evidence",title:"Evidence isolation",status:"Completed",expiresAt:"2099-01-01T00:00:00.000Z",events,signers:[signer,reviewer],completion:{finalHash:documentHash}};
  const ctx={now:()=>new Date("2026-11-16T14:00:00.000Z"),meta:{
    get:async(collection,id)=>collection==="envelopes"&&id===envelopeId?structuredClone(envelope):null,
    list:async collection=>collection==="cryptographicEvidence"?[ownEvidence,otherEvidence]:[],
  }};
  const result=await getSigningEvidence(ctx,`ENV-evidence-isolation.S1.${secret}`,null);
  assert.equal(result.evidence.length,1);
  assert.equal(result.evidence[0].signerId,"S1");
  assert.equal(result.evidence.some(item=>item.signerId==="S2"),false);
});

test("email-link open returns only this signer's fields and never another signer's saved signature", async () => {
  const secret = "a".repeat(64);
  const signer = { ...externalSigner, tokenHash: await sha256Hex(secret), emailLinkExpiresAt: "2099-01-01T00:00:00.000Z", emailLinkStatus: "opened" };
  const reviewer = { ...otherSigner, tokenHash: await sha256Hex("b".repeat(64)), status: "Signed", fieldValues: { "reviewer-signature": "PRIVATE-SAVED-SIGNATURE" }, uid: "reviewer-uid" };
  const envelope = {
    id: "ENV-test", documentId: "DOC-test", title: "Test", status: "InProgress",
    expiresAt: "2099-01-01T00:00:00.000Z", events: [],
    signers: [signer, reviewer],
    fields: [
      { fieldId: "vendor-name", signerId: "S1", type: "Name", page: 1 },
      { fieldId: "reviewer-signature", signerId: "S2", type: "Signature", page: 1 },
    ],
  };
  const ctx = {
    now: () => new Date("2026-11-16T14:00:00.000Z"),
    meta: { get: async (collection, id) => collection === "envelopes" && id === envelope.id ? structuredClone(envelope) : null },
  };
  const result = await openSigning(ctx, `ENV-test.S1.${secret}`, null);
  await assert.rejects(()=>openSigning(ctx,`ENV-test.S2.${secret}`,null),/not valid|invalid signing link/i,"an invitation token for S1 must not be usable as S2");
  assert.deepEqual(result.fields.map(field => field.fieldId), ["vendor-name"]);
  assert.deepEqual(result.appliedFields, []);
  assert.equal(JSON.stringify(result).includes("PRIVATE-SAVED-SIGNATURE"), false);
  assert.equal(JSON.stringify(result).includes("reviewer-uid"), false);
});


test("required fields are rejected server-side until every required assigned field is complete",()=>{
  const fields=validateEnvelopeFields([
    {fieldId:"name",signerId:"S1",type:"Name",required:true,page:1},
    {fieldId:"date",signerId:"S1",type:"Date",required:true,page:2},
  ],[externalSigner]);
  assert.throws(()=>validateFieldValues(fields,externalSigner,{name:"Vendor"},{type:"typed",value:"Vendor"},[]),/assigned date field/);
  assert.deepEqual(validateFieldValues(fields,externalSigner,{name:"Vendor",date:"2026-11-17"},{type:"typed",value:"Vendor"},[]),{name:"Vendor",date:"2026-11-17"});
});

test("confirmed signature specimens support the bounded aggregate request budget",()=>{
  const fields=validateEnvelopeFields([
    {fieldId:"sig-a",signerId:"S1",type:"Signature",required:true,page:1},
    {fieldId:"sig-b",signerId:"S1",type:"Initials",required:true,page:2},
  ],[externalSigner]);
  const app=(fieldId,value)=>({fieldId,page:fieldId==="sig-a"?1:2,x:0.1,y:0.8,width:0.24,height:0.09,coordinateSpace:"visible-page-fraction-v1",confirmed:true,value});
  const markA="data:image/png;base64,"+"A".repeat(110000);
  const markB="data:image/png;base64,"+"B".repeat(110000);
  const values=validateFieldValues(fields,externalSigner,{}, {type:"typed",value:"Vendor"},[app("sig-a",markA),app("sig-b",markB)]);
  assert.equal(values["sig-a"],markA);
  assert.equal(values["sig-b"],markB);
  assert.throws(()=>validateFieldValues(fields,externalSigner,{}, {type:"typed",value:"Vendor"},[app("sig-a","data:image/png;base64,"+"A".repeat(120001)),app("sig-b",markB)]),/no larger than 120 KB/);
});


test("every assigned field must be completed, including fields not marked required",()=>{
  const fields=validateEnvelopeFields([
    {fieldId:"name",signerId:"S1",type:"Name",required:true,page:1},
    {fieldId:"comment",signerId:"S1",type:"Comment",required:false,page:2},
    {fieldId:"optional-check",signerId:"S1",type:"Checkbox",required:false,page:2},
  ],[externalSigner]);
  assert.throws(()=>validateFieldValues(fields,externalSigner,{name:"Vendor"},{type:"typed",value:"Vendor"},[]),/Complete the assigned comment field/);
  assert.throws(()=>validateFieldValues(fields,externalSigner,{name:"Vendor",comment:"Reviewed"},{type:"typed",value:"Vendor"},[]),/Complete the assigned checkbox field/);
  assert.deepEqual(validateFieldValues(fields,externalSigner,{name:"Vendor",comment:"Reviewed","optional-check":false},{type:"typed",value:"Vendor"},[]),{name:"Vendor",comment:"Reviewed","optional-check":"false"});
});

test("required checkbox fields accept only an explicit checked value and signature fields retain independent specimens",()=>{
  const fields=validateEnvelopeFields([
    {fieldId:"agree",signerId:"S1",type:"Checkbox",required:true,page:1},
    {fieldId:"sig-a",signerId:"S1",type:"Signature",required:true,page:1},
    {fieldId:"sig-b",signerId:"S1",type:"Signature",required:true,page:1},
    {fieldId:"initials",signerId:"S1",type:"Initials",required:true,page:1},
  ],[externalSigner]);
  const app=(fieldId,value)=>({fieldId,page:1,x:0.1,y:0.8,width:0.24,height:0.09,coordinateSpace:"visible-page-fraction-v1",confirmed:true,value});
  const markA="data:image/png;base64,"+"A".repeat(100);
  const markB="data:image/png;base64,"+"B".repeat(100);
  const markI="data:image/png;base64,"+"C".repeat(100);
  assert.throws(()=>validateFieldValues(fields,externalSigner,{agree:"false"},{type:"typed",value:"Vendor"},[app("sig-a",markA),app("sig-b",markB),app("initials",markI)]),/required checkbox/);
  const values=validateFieldValues(fields,externalSigner,{agree:"true"},{type:"typed",value:"Vendor"},[app("sig-a",markA),app("sig-b",markB),app("initials",markI)]);
  assert.equal(values.agree,"true");
  assert.equal(values["sig-a"],markA);
  assert.equal(values["sig-b"],markB);
  assert.equal(values.initials,markI);
});


test("legacy saved percentage fields are normalized before checking confirmed signature placement", () => {
  const legacyFields = [{ fieldId: "legacy-signature", signerId: "S1", type: "Signature", page: 1, x: 10, y: 80, width: 24, height: 9 }];
  const mark = "data:image/png;base64," + "A".repeat(100);
  const confirmed = [{ fieldId: "legacy-signature", page: 1, x: 0.1, y: 0.8, width: 0.24, height: 0.09, coordinateSpace: "visible-page-fraction-v1", confirmed: true, value: mark }];
  assert.deepEqual(validateFieldValues(legacyFields, externalSigner, {}, { type: "typed", value: "Vendor" }, confirmed), { "legacy-signature": mark });
});


test("field confirmation rejects an unsupported coordinate-space marker", () => {
  const fields = validateEnvelopeFields([
    { fieldId: "future-space-signature", signerId: "S1", type: "Signature", page: 1, x: 10, y: 80, width: 24, height: 9 }
  ], [externalSigner]);
  const confirmed = [{
    fieldId: "future-space-signature",
    page: 1,
    x: 0.1,
    y: 0.8,
    width: 0.24,
    height: 0.09,
    coordinateSpace: "future-coordinate-v2",
    confirmed: true,
    value: "data:image/png;base64," + "A".repeat(100)
  }];
  assert.throws(
    () => validateFieldValues(fields, externalSigner, {}, { type: "typed", value: "Vendor" }, confirmed),
    /coordinate space is not supported/
  );
});
