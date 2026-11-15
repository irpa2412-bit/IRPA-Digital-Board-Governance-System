const assert = require("node:assert/strict");
const { before, after, beforeEach, test } = require("node:test");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const fs = require("node:fs");

let testEnv;
const projectId = process.env.GCLOUD_PROJECT || "irpa-digital-board-governance";
before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") }
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("systemSettings/actualDataAccess").set({enabled:true,status:"OPEN",finalTestsAttested:true});
    await db.doc("members/assigned-signer").set({uid:"assigned-signer",status:"Active",role:"Board Member"});
    await db.doc("signatureEnvelopes/gateway-envelope").set({
      senderUid:"assigned-signer",ownerUid:"assigned-signer",envelopeReference:"ENV-GATEWAY",
      documentId:"DOC-GATEWAY",participantUids:["assigned-signer"],actionUids:["assigned-signer"],
      signingMode:"Sequential",currentSignerUid:"assigned-signer",status:"In Progress",
      gatewayEnvelopeId:"ENV-CRYPTO-1"
    });
    await db.doc("signatureEnvelopes/legacy-envelope").set({
      senderUid:"assigned-signer",ownerUid:"assigned-signer",envelopeReference:"ENV-LEGACY",
      documentId:"DOC-LEGACY",participantUids:["assigned-signer"],actionUids:["assigned-signer"],
      signingMode:"Sequential",currentSignerUid:"assigned-signer",status:"In Progress"
    });
  });
});
const signerDb = () => testEnv.authenticatedContext("assigned-signer", {email:"signer@example.test"}).firestore();

test("Gateway owner may link a newly-created Gateway envelope exactly once using activation metadata only", async () => {
  const db = signerDb();
  await assertSucceeds(db.doc("signatureEnvelopes/legacy-envelope").update({
    gatewayEnvelopeId:"ENV-CRYPTO-2",gatewayDocumentId:"DOC-CRYPTO-2",
    gatewayOriginalHash:"a".repeat(64),gatewaySigningStatus:"Sent",
    gatewayBridgeStatus:"Connected",gatewayEvidenceSchema:"IRPA-CRYPTOGRAPHIC-EVIDENCE-1",
    status:"In Progress",workflowStartedAt:new Date(),workflowStartedByUid:"assigned-signer",updatedAt:new Date()
  }));
  await assertFails(db.doc("signatureEnvelopes/legacy-envelope").update({
    gatewayEnvelopeId:"ENV-CRYPTO-3",gatewayDocumentId:"DOC-CRYPTO-3",
    gatewayOriginalHash:"b".repeat(64),gatewaySigningStatus:"Sent",
    gatewayBridgeStatus:"Connected",gatewayEvidenceSchema:"IRPA-CRYPTOGRAPHIC-EVIDENCE-1",
    status:"In Progress",workflowStartedAt:new Date(),workflowStartedByUid:"assigned-signer",updatedAt:new Date()
  }));
});

test("clients cannot create envelopes pre-marked as Gateway-backed", async () => {
  await assertFails(signerDb().doc("signatureEnvelopes/forged-gateway-envelope").set({
    senderUid:"assigned-signer",ownerUid:"assigned-signer",envelopeReference:"ENV-FORGED",
    documentId:"DOC-FORGED",participantUids:["assigned-signer"],actionUids:["assigned-signer"],
    signingMode:"Sequential",currentSignerUid:"assigned-signer",status:"Draft",
    gatewayEnvelopeId:"ENV-ATTACKER"
  }));
});

test("participants cannot mutate the authoritative state of Gateway-backed envelopes", async () => {
  await assertFails(signerDb().doc("signatureEnvelopes/gateway-envelope").update({
    status:"Completed",lastSignedByUid:"assigned-signer",lastSignedAt:new Date(),
    workflowHistory:[{uid:"assigned-signer",status:"Signed"}]
  }));
});

test("clients cannot create signature records for Gateway-backed envelopes", async () => {
  await assertFails(signerDb().doc("signatures/forged-gateway-signature").set({
    envelopeId:"gateway-envelope",signerUid:"assigned-signer",signerIdentityId:"assigned-signer",
    signatureAuthority:"Board Member",signatureStatus:"Signed",status:"Signed"
  }));
});

test("clients cannot create audit events for Gateway-backed envelopes", async () => {
  await assertFails(signerDb().doc("signatureEvents/forged-gateway-event").set({
    envelopeId:"gateway-envelope",actorUid:"assigned-signer",event:"Gateway Signature Submitted"
  }));
});

test("legacy envelope participant signing updates remain subject to the existing participant and routing checks", async () => {
  await assertSucceeds(signerDb().doc("signatureEnvelopes/legacy-envelope").update({
    status:"In Progress",lastSignedByUid:"assigned-signer"
  }));
});

test("legacy non-Gateway envelope audit event creation remains available to an active member", async () => {
  await assertSucceeds(signerDb().doc("signatureEvents/legacy-event").set({
    envelopeId:"legacy-envelope",actorUid:"assigned-signer",event:"Legacy Signature Submitted"
  }));
});
