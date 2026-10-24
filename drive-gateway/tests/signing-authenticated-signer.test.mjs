import assert from "node:assert/strict";
import test from "node:test";
import {canAuthenticatedSignerAccess} from "../src/signing.mjs";

test("external signer tokens remain usable without an authenticated user",()=>{
  assert.equal(canAuthenticatedSignerAccess({uid:null},null),true);
  assert.equal(canAuthenticatedSignerAccess({uid:undefined},undefined),true);
});

test("UID-bound signer requires the matching authenticated UID",()=>{
  assert.equal(canAuthenticatedSignerAccess({uid:"member-123"},null),false);
  assert.equal(canAuthenticatedSignerAccess({uid:"member-123"},{uid:"other-user"}),false);
  assert.equal(canAuthenticatedSignerAccess({uid:"member-123"},{uid:"member-123"}),true);
});

test("UID-bound signer comparison is exact and cannot be bypassed by email alone",()=>{
  assert.equal(canAuthenticatedSignerAccess({uid:"member-123"},{uid:"member-123",email:"different@example.com"}),true);
  assert.equal(canAuthenticatedSignerAccess({uid:"member-123"},{uid:"member-124",email:"member@example.com"}),false);
});

import {createHash} from "node:crypto";
import {sign} from "../src/signing.mjs";

test("staging sign rejects a context without signing-authority verification",async()=>{
  const secret="a".repeat(64);
  const hash=createHash("sha256").update(secret).digest("hex");
  const envelope={
    id:"ENV-staging-test",
    documentId:"DOC-staging-test",
    documentHash:"unused-before-authority-check",
    expiresAt:"2999-01-01T00:00:00.000Z",
    status:"Sent",
    signingMode:"Sequential",
    events:[],
    signers:[{id:"S1",uid:"staging-user",status:"Pending",order:1,tokenHash:hash}]
  };
  const ctx={
    env:{IRPA_ENVIRONMENT:"staging"},
    now:()=>new Date("2026-10-24T00:00:00.000Z"),
    meta:{get:async(collection,id)=>collection==="envelopes"&&id===envelope.id?envelope:null},
    storage:{get:async()=>{throw new Error("Storage must not be reached before authority configuration is checked.");}}
  };
  await assert.rejects(
    sign(ctx,{
      token:envelope.id+".S1."+secret,
      signature:{type:"typed",value:"Staging test signer"},
      consent:true,
      manualAuthorityIdentification:"Test Authority",
      user:{uid:"staging-user",email:"staging@example.invalid",token:"staging-id-token"}
    }),
    error=>error?.status===503&&error.message==="Signing authority verification is not configured on this gateway."
  );
});
