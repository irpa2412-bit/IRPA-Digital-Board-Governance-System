import test from "node:test";
import assert from "node:assert/strict";
import { canSendSignatureInvitation } from "../src/signatureInvitationPolicy.mjs";

const recipients=[{uid:"owner",status:"Pending"},{uid:"signer-a",status:"Signed",completedAt:"2026-11-07T10:00:00Z"},{uid:"signer-b",status:"Current"}];
test("owner can send an invitation to an assigned signer",()=>assert.equal(canSendSignatureInvitation({actorUid:"owner",ownerUid:"owner",signerUid:"signer-b",currentSignerUid:"signer-b",recipients}),true));
test("previous signed signer can release exactly the current next signer",()=>assert.equal(canSendSignatureInvitation({actorUid:"signer-a",ownerUid:"owner",signerUid:"signer-b",currentSignerUid:"signer-b",recipients,workflowHistory:[]}),true));
test("unsigned signer cannot send a next-signer invitation",()=>assert.equal(canSendSignatureInvitation({actorUid:"signer-a",ownerUid:"owner",signerUid:"signer-b",currentSignerUid:"signer-b",recipients:[{uid:"signer-a",status:"Pending"},{uid:"signer-b",status:"Current"}]}),false));
test("a signer cannot invite a different or future recipient",()=>assert.equal(canSendSignatureInvitation({actorUid:"signer-a",ownerUid:"owner",signerUid:"owner",currentSignerUid:"signer-b",recipients}),false));
test("parallel routing does not permit signer-triggered next-signer mail",()=>assert.equal(canSendSignatureInvitation({actorUid:"signer-a",ownerUid:"owner",signerUid:"signer-b",currentSignerUid:"signer-b",signingMode:"Parallel",recipients}),false));
