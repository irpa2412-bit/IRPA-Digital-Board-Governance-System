import test from "node:test";
import assert from "node:assert/strict";
import { makeContext, route } from "../src/router.mjs";
import { sha256Hex } from "../src/util.mjs";

function fixture({actor="owner",tamper=false}={}) {
  const bytes=new TextEncoder().encode("%PDF-1.7\\nIRPA completed document");
  const envelope={
    id:"ENV-COMPLETED-00000001",
    createdBy:"owner",
    documentId:"DOC-COMPLETED-1",
    status:"Completed",
    signers:[{id:"S1",uid:"signer",status:"Signed"}],
    events:[],
    completion:{primaryStorageId:"signed-pdf",finalHash:"",fileName:"completed.pdf",completedAt:"2026-11-24T06:00:00.000Z"}
  };
  const expected=sha256Hex(bytes);
  let mirrorWrites=0;const meta={async get(collection,id){return collection==="envelopes"&&id===envelope.id?envelope:null;},async list(){return [];},async update(){mirrorWrites++;}};
  const storage={async get(id){return id==="signed-pdf"?(tamper?new TextEncoder().encode("%PDF-1.7\\ntampered"):bytes):null;}};
  const ctx=makeContext({meta,storage,now:()=>new Date("2026-11-24T06:00:00.000Z"),verifyUser:async request=>request.headers.get("authorization")==="Bearer "+actor?{uid:actor}:null});
  ctx.persistCompletedSignatureEnvelope=async()=>{mirrorWrites++;};return {ctx,envelope,bytes,expected,get mirrorWrites(){return mirrorWrites;}};
}

test("owner can read only the completed PDF after signer, audit and SHA-256 checks",async()=>{
  const f=fixture();f.envelope.completion.finalHash=await f.expected;
  const response=await route(new Request("https://gateway.test/api/envelopes/ENV-COMPLETED-00000001/completed-document.pdf",{headers:{authorization:"Bearer owner"}}),f.ctx);
  assert.equal(response.status,200);
  assert.equal(response.headers.get("content-type"),"application/pdf");
  assert.equal(response.headers.get("x-document-sha256"),await f.expected);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.bytes);\n  assert.equal(f.mirrorWrites,0,"the read-only completed-document route must not reconcile or mutate the Firestore mirror");
});

test("non-owner cannot retrieve the authoritative completed PDF",async()=>{
  const f=fixture({actor:"other"});f.envelope.completion.finalHash=await f.expected;
  const response=await route(new Request("https://gateway.test/api/envelopes/ENV-COMPLETED-00000001/completed-document.pdf",{headers:{authorization:"Bearer other"}}),f.ctx);
  assert.equal(response.status,403);
});

test("tampered completed PDF is withheld",async()=>{
  const f=fixture({tamper:true});f.envelope.completion.finalHash=await f.expected;
  const response=await route(new Request("https://gateway.test/api/envelopes/ENV-COMPLETED-00000001/completed-document.pdf",{headers:{authorization:"Bearer owner"}}),f.ctx);
  assert.equal(response.status,409);
});
