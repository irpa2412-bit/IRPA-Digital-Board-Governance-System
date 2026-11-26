import test from "node:test";
import assert from "node:assert/strict";
import { getRecoveryQueue } from "../src/signatureRecovery.mjs";

const envelope = {
  id: "IRPA-ENV-2026-54530056",
  documentId: "bYcgwszYnuOieHiwbg7O",
  ownerUid: "UQxfLOXCl7bEQ7KNM6Tt4eKoJlg1",
  recordOrigin: "TRIAL",
  status: "InProgress",
  signers: Array.from({length:17},(_,index)=>({
    id: "signer-"+(index+1),
    order: index+1,
    role: index===16 ? "Pending signer" : "Signer",
    status: index===16 ? "Pending" : "Signed",
    signedAt: index===16 ? null : "2026-11-25T12:00:00.000Z"
  }))
};

test("recovery queue falls back to signatureEnvelopes for the Court envelope shape without writing", async()=>{
  const writes=[];
  const ctx={
    meta:{
      async list(collection){
        if(collection==="envelopes") return [];
        if(collection==="signatureEnvelopes") return [structuredClone(envelope)];
        throw new Error("unexpected collection "+collection);
      },
      async get(collection,id){
        if(collection==="envelopes") return null;
        if(collection==="signatureEnvelopes" && id===envelope.id) return structuredClone(envelope);
        return null;
      },
      async create(...args){writes.push(args);throw new Error("read-only test forbids writes");}
    }
  };
  const result=await getRecoveryQueue(ctx,{uid:envelope.ownerUid},{recordAccess:false});
  assert.equal(result.total,1);
  assert.equal(result.items[0].envelopeId,"IRPA-ENV-2026-54530056");
  assert.equal(result.items[0].documentId,"bYcgwszYnuOieHiwbg7O");
  assert.equal(result.items[0].signerCount,17);
  assert.equal(writes.length,0);
});
