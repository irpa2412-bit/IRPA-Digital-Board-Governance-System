import assert from "node:assert/strict";
import test from "node:test";
import {canAuthenticatedSignerAccess} from "../src/signing.mjs";

test("unbound legacy signers are not accepted as authenticated production identities",()=>{
  assert.equal(canAuthenticatedSignerAccess({uid:null,identityType:"legacy-token"},null),true);
  assert.equal(canAuthenticatedSignerAccess({uid:undefined,identityType:"legacy-token"},undefined),true);
  assert.equal(canAuthenticatedSignerAccess({uid:null,identityType:"email-link",emailLinkStatus:"issued"},null),false);
  assert.equal(canAuthenticatedSignerAccess({uid:null,identityType:"email-link",emailLinkStatus:"opened"},null),true);
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

test("staging signing does not require IRPA register authority but retains signer authentication and declarations",async()=>{
  const secret="a".repeat(64);
  const hash=createHash("sha256").update(secret).digest("hex");
  const envelope={
    id:"ENV-staging-test",
    documentId:"DOC-staging-test",
    documentHash:"unused-before-source-check",
    expiresAt:"2999-01-01T00:00:00.000Z",
    status:"Sent",
    signingMode:"Sequential",
    events:[],
    signers:[{id:"S1",uid:"staging-user",identityType:"account",status:"Pending",order:1,tokenHash:hash}]
  };
  const ctx={
    env:{IRPA_ENVIRONMENT:"staging"},
    now:()=>new Date("2026-10-24T00:00:00.000Z"),
    meta:{get:async(collection,id)=>collection==="envelopes"&&id===envelope.id?envelope:null},
    storage:{get:async()=>null}
  };
  await assert.rejects(
    sign(ctx,{
      token:envelope.id+".S1."+secret,
      signature:{type:"typed",value:"Staging test signer"},
      consent:true,
      declarations:{name:"Staging Test Signer",occupation:"Independent Test Signer"},
      user:{uid:"other-user",email:"staging@example.invalid",token:"staging-id-token"}
    }),
    error=>error?.status===403&&error.message==="Sign in as the invited signer to continue."
  );
  await assert.rejects(
    sign(ctx,{
      token:envelope.id+".S1."+secret,
      signature:{type:"typed",value:"Staging test signer"},
      consent:true,
      declarations:{name:"Staging Test Signer",occupation:"Independent Test Signer"},
      user:{uid:"staging-user",email:"staging@example.invalid",token:"staging-id-token"}
    }),
    error=>error?.status===409&&error.message==="The source document is unavailable."
  );
  await assert.rejects(
    sign(ctx,{
      token:envelope.id+".S1."+secret,
      signature:{type:"typed",value:"Staging test signer"},
      consent:true,
      user:{uid:"staging-user",email:"staging@example.invalid",token:"staging-id-token"}
    }),
    error=>error?.status===400&&error.message==="Enter your name and occupation/capacity for this document before signing."
  );
});
