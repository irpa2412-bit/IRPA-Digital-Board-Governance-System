import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { buildUnarchivedCompletedCopy } from "../src/courtRecoveryCopy.mjs";
import { sha256Hex } from "../src/util.mjs";

async function fixture(){
 const pdf=await PDFDocument.create();pdf.addPage([595,842]);
 const source=new Uint8Array(await pdf.save()),hash=await sha256Hex(source);
 const envelope={id:"IRPA-ENV-2026-11501354",createdBy:"court-owner",status:"CompletionFailed",documentId:"DOC-COURT-1",documentHash:hash,title:"Court session",events:[],signers:[],fields:[],completion:{finalHash:null}};
 let writes=0;
 const ctx={meta:{async get(table){return table==="envelopes"?envelope:table==="documents"?{primaryStorageId:"source"}:null;},async update(){writes++;throw Error("write forbidden");},async create(){writes++;throw Error("write forbidden");}},storage:{async get(){return new Uint8Array(source);},async put(){writes++;throw Error("write forbidden");},async delete(){writes++;throw Error("write forbidden");}},now:()=>new Date("2026-11-23T06:00:00.000Z")};
 return{ctx,envelope,source,getWrites:()=>writes};
}
test("court recovery PDF is generated in memory without writes and hash matches returned bytes",async()=>{
 const f=await fixture(),result=await buildUnarchivedCompletedCopy(f.ctx,{uid:"court-owner"},f.envelope.id);
 assert.ok(result.bytes instanceof Uint8Array);
 assert.equal(await sha256Hex(result.bytes),result.hash);
 assert.equal(result.comparison,"NO_RECORDED_HASH");
 assert.equal(f.getWrites(),0);
 assert.equal(f.envelope.status,"CompletionFailed");
});
test("court recovery PDF download rejects non-owner with 403",async()=>{
 const f=await fixture();
 await assert.rejects(()=>buildUnarchivedCompletedCopy(f.ctx,{uid:"not-owner"},f.envelope.id),e=>e.status===403);
 assert.equal(f.getWrites(),0);
});
test("recorded final PDF hash is compared without mutating envelope",async()=>{
 const f=await fixture();
 const first=await buildUnarchivedCompletedCopy(f.ctx,{uid:"court-owner"},f.envelope.id);
 f.envelope.completion.finalHash=first.hash;
 const second=await buildUnarchivedCompletedCopy(f.ctx,{uid:"court-owner"},f.envelope.id);
 assert.equal(second.comparison,"MATCH");
 assert.equal(f.getWrites(),0);
});
