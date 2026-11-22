import test from "node:test";
import assert from "node:assert/strict";
import {retryCompletion} from "../src/signing.mjs";
import {diagnoseFinalisation} from "../src/finalisationDiagnostics.mjs";
import {buildUnarchivedCompletedCopy} from "../src/courtRecoveryCopy.mjs";

function trialEnvelope(){
 return{id:"IRPA-ENV-2026-11501354",createdBy:"owner-1",dataEnvironment:"TRIAL",status:"CompletionFailed",documentId:"DOC-1",archiveTargets:["completed-signed"],classification:"Confidential",fileName:"record.pdf",events:[],signers:[{id:"S1",uid:"signer-1",status:"Signed"}],completion:{archivePending:{storageId:"trial-pending-pdf",finalHash:"a".repeat(64),environment:"TRIAL",fileName:"record-signed.pdf"}}};
}
function fixture(){
 const envelope=trialEnvelope();let writes=0,storageReads=0,archiveProbes=0,metaReads=[];
 const ctx={env:{IRPA_ENVIRONMENT:"production",DRIVE_MOCK:"false"},allowReturnTokens:false,meta:{async get(table,id){metaReads.push(table);return table==="envelopes"?envelope:null;},async update(){writes++;throw Error("write forbidden");},async create(){writes++;throw Error("write forbidden");}},storage:{async get(){storageReads++;return new Uint8Array([1,2,3]);},async put(){writes++;throw Error("write forbidden");},async delete(){writes++;throw Error("write forbidden");},async probeWritePermissionDetailed(){archiveProbes++;throw Error("cross-environment probe forbidden");}},now:()=>new Date("2026-11-23T00:00:00.000Z")};
 return{ctx,envelope,getWrites:()=>writes,getStorageReads:()=>storageReads,getArchiveProbes:()=>archiveProbes,metaReads};
}

test("TRIAL envelope remains pinned when current Worker is ACTUAL: retry, dry-run and download fail closed",async()=>{
 const f=fixture();
 await assert.rejects(()=>retryCompletion(f.ctx,{uid:"owner-1"},f.envelope.id),e=>e.status===409);
 await assert.rejects(()=>diagnoseFinalisation(f.ctx,{uid:"owner-1"},f.envelope.id),e=>e.status===409);
 await assert.rejects(()=>buildUnarchivedCompletedCopy(f.ctx,{uid:"owner-1"},f.envelope.id),e=>e.status===409);
 assert.equal(f.getWrites(),0);
 assert.equal(f.getStorageReads(),0);
 assert.equal(f.getArchiveProbes(),0);
 assert.ok(f.metaReads.every(table=>table==="envelopes"));
});

test("non-owner cannot invoke a TRIAL-to-ACTUAL archive diagnostic",async()=>{
 const f=fixture();f.ctx.env.IRPA_ENVIRONMENT="staging";
 await assert.rejects(()=>diagnoseFinalisation(f.ctx,{uid:"intruder"},f.envelope.id),e=>e.status===403);
 assert.equal(f.getWrites(),0);assert.equal(f.getStorageReads(),0);assert.equal(f.getArchiveProbes(),0);
});
