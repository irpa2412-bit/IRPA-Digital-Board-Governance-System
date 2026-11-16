import test from "node:test";
import assert from "node:assert/strict";
import { canAuthenticatedSignerAccess, validateEnvelopeFields, validateFieldValues, openSigning, getSigningEvidence, chainEvents } from "../src/signing.mjs";
import { generateSignerKeyPair, exportPublicKeyJwk, createCryptographicEvidence } from "../src/cryptographicGate.mjs";
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
  assert.equal(canAuthenticatedSignerAccess({ id: "S3", identityType: "legacy-token" }, null), true); // Token hash is verified by load() before this policy is reached.
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
    const pair=await generateSignerKeyPair();
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
