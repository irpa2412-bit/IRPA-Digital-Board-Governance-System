import test from "node:test";
import assert from "node:assert/strict";
import { buildUnarchivedCompletedCopy } from "../src/courtRecoveryCopy.mjs";
import { sha256Hex } from "../src/util.mjs";

async function fixture(){
 const bytes=new TextEncoder().encode("%PDF-1.7\nexisting-preserved-final-pdf\n%%EOF");
 const hash=await sha256Hex(bytes);
 const envelope={id:"IRPA-ENV-2026-11501354",createdBy:"court-owner",status:"CompletionFailed",dataEnvironment:"trial",completion:{finalHash:hash,archivePending:{storageId:"pending-pdf",finalHash:hash,fileName:"court-copy.pdf",createdAt:"2026-11-23T06:00:00.000Z",environment:"trial"}}};
 let writes=0,reads=0;
 const ctx={env:{IRPA_ENVIRONMENT:"trial"},meta:{async get(){return envelope;},async update(){writes++;throw Error("write forbidden");},async create(){writes++;throw Error("write forbidden");}},storage:{async get(id){reads++;assert.equal(id,"pending-pdf");return new Uint8Array(bytes);},async put(){writes++;throw Error("write forbidden");},async delete(){writes++;throw Error("write forbidden");}},now:()=>new Date("2026-11-23T06:00:00.000Z")};
 return{ctx,envelope,bytes,getWrites:()=>writes,getReads:()=>reads,hash};
}
test("download returns exact preserved bytes and SHA-256 without writes or rebuilding",async()=>{
 const f=await fixture(),result=await buildUnarchivedCompletedCopy(f.ctx,{uid:"court-owner"},f.envelope.id);
 assert.deepEqual(result.bytes,f.bytes);
 assert.equal(await sha256Hex(result.bytes),f.hash);
 assert.equal(result.hash,f.hash);
 assert.equal(result.comparison,"MATCH");
 assert.equal(result.environment,"trial");
 assert.equal(f.getReads(),1);
 assert.equal(f.getWrites(),0);
 assert.equal(f.envelope.status,"CompletionFailed");
});
test("download rejects a non-owner with 403 and performs no storage read",async()=>{
 const f=await fixture();
 await assert.rejects(()=>buildUnarchivedCompletedCopy(f.ctx,{uid:"not-owner"},f.envelope.id),e=>e.status===403);
 assert.equal(f.getReads(),0);
 assert.equal(f.getWrites(),0);
});
test("download fails closed when no archive-pending PDF was preserved",async()=>{
 const f=await fixture();
 delete f.envelope.completion.archivePending;
 await assert.rejects(()=>buildUnarchivedCompletedCopy(f.ctx,{uid:"court-owner"},f.envelope.id),e=>e.status===409);
 assert.equal(f.getReads(),0);
 assert.equal(f.getWrites(),0);
});
test("preserved TRIAL copy is served when the Worker switch is ACTUAL and the result is switch-independent",async()=>{
 const f=await fixture();
 f.ctx.env.IRPA_ENVIRONMENT="production";
 const actual=await buildUnarchivedCompletedCopy(f.ctx,{uid:"court-owner"},f.envelope.id);
 f.ctx.env.IRPA_ENVIRONMENT="staging";
 const trial=await buildUnarchivedCompletedCopy(f.ctx,{uid:"court-owner"},f.envelope.id);
 assert.deepEqual(actual.bytes,f.bytes);assert.deepEqual(trial.bytes,f.bytes);
 assert.equal(actual.hash,f.hash);assert.equal(trial.hash,f.hash);
 assert.equal(actual.environment,"trial");assert.equal(trial.environment,"trial");
 assert.equal(f.getReads(),2);assert.equal(f.getWrites(),0);
});
test("preserved-copy environment mismatch is classified for emergency fallback",async()=>{
 const f=await fixture();f.envelope.completion.archivePending.environment="ACTUAL";
 await assert.rejects(()=>buildUnarchivedCompletedCopy(f.ctx,{uid:"court-owner"},f.envelope.id),e=>e.code==="PRESERVED_COPY_ENV_MISMATCH");
 assert.equal(f.getReads(),0);assert.equal(f.getWrites(),0);
});
test("missing preserved copy is classified for emergency fallback",async()=>{
 const f=await fixture();delete f.envelope.completion.archivePending.storageId;
 await assert.rejects(()=>buildUnarchivedCompletedCopy(f.ctx,{uid:"court-owner"},f.envelope.id),e=>e.code==="PRESERVED_COPY_MISSING");
 assert.equal(f.getReads(),0);assert.equal(f.getWrites(),0);
});
test("download rejects bytes that do not match the preserved final hash",async()=>{
 const f=await fixture();
 f.ctx.storage.get=async()=>new TextEncoder().encode("%PDF-1.7\nwrong bytes\n%%EOF");
 await assert.rejects(()=>buildUnarchivedCompletedCopy(f.ctx,{uid:"court-owner"},f.envelope.id),e=>e.code==="HASH_MISMATCH");
 assert.equal(f.getWrites(),0);
});
