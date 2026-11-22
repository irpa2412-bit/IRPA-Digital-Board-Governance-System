import test from "node:test";
import assert from "node:assert/strict";
import {PDFDocument} from "pdf-lib";
import {diagnoseFinalisation} from "../src/finalisationDiagnostics.mjs";
import {sha256Hex} from "../src/util.mjs";
async function fixture(){
 const pdf=await PDFDocument.create();pdf.addPage([595,842]);pdf.addPage([595,842]);pdf.addPage([595,842]);const bytes=new Uint8Array(await pdf.save());
 const envelope={id:"ENV-DRYRUN-001",createdBy:"owner-1",status:"CompletionFailed",documentId:"DOC-1",documentHash:await sha256Hex(bytes),title:"Diagnostic fixture",fileName:"fixture.pdf",events:[{hash:"a".repeat(64)}],signers:[{id:"S1",uid:"signer-1",name:"Signer",status:"Signed",signedAt:"2026-11-22T08:00:00.000Z",signatureType:"typed",signatureValue:"Signed",fieldValues:{date:"2026-11-22"}}],fields:[{fieldId:"F1",type:"Date",page:1,x:10,y:10,width:20,height:5,rotation:0,signerId:"S1"},{fieldId:"F3",type:"Signature",page:3,x:20,y:20,width:30,height:8,rotation:90,signerId:"S1"}],archiveTargets:["governance"],classification:"Confidential",ownerEmail:"owner@example.org"};
 let writes=0;const ctx={meta:{async get(table,id){if(table==="envelopes")return envelope;if(table==="documents")return{primaryStorageId:"SOURCE"};return null;},async update(){writes++;throw Error("write blocked");},async create(){writes++;throw Error("write blocked");}},storage:{async get(){return bytes;},async put(){writes++;throw Error("write blocked");},async delete(){writes++;throw Error("write blocked");},async probeWritePermission(){return true;}},sendCompletionEmail:async()=>{writes++;throw Error("email send blocked");},now:()=>new Date("2026-11-22T18:00:00Z"),env:{IRPA_ENVIRONMENT:"test"},allowReturnTokens:true};
 return{ctx,envelope,getWrites:()=>writes};
}
test("diagnostic is owner-only and denies a non-owner with 403",async()=>{const{ctx}=await fixture();await assert.rejects(()=>diagnoseFinalisation(ctx,{uid:"other-user"}, "ENV-DRYRUN-001"),e=>e.status===403);});
test("dry run builds PDF and hash without envelope, audit, archive, Drive or email writes",async()=>{const{ctx,getWrites}=await fixture();const report=await diagnoseFinalisation(ctx,{uid:"owner-1"},"ENV-DRYRUN-001");assert.equal(report.readOnly,true);assert.equal(report.steps.find(x=>x.stageCode==="PDF_BUILD").status,"PASS");assert.equal(report.steps.find(x=>x.stageCode==="HASH").status,"PASS");assert.equal(report.steps.find(x=>x.stageCode==="ARCHIVE").status,"PASS");assert.equal(report.steps.find(x=>x.stageCode==="DISTRIBUTION").status,"PASS");assert.equal(report.fieldChecks.length,2);assert.equal(report.fieldChecks.find(x=>x.fieldId==="F3").rotation,90);assert.equal(getWrites(),0);});
test("diagnostic marks archive permission unavailable without attempting a write",async()=>{const{ctx,getWrites}=await fixture();delete ctx.storage.probeWritePermission;const report=await diagnoseFinalisation(ctx,{uid:"owner-1"},"ENV-DRYRUN-001");assert.equal(report.steps.find(x=>x.stageCode==="ARCHIVE").errorCode,"ARCHIVE_PERMISSION_PROBE_UNAVAILABLE");assert.equal(getWrites(),0);});

test("finalisation dry-run accepts the three supported owner identity fields and still denies outsiders",async()=>{
 const {ctx}=await fixture();
 await ctx.meta.update("envelopes","ENV-DRYRUN-001",{createdBy:undefined,createdByUid:"owner-1"});
 const ownerReport=await diagnoseFinalisation(ctx,{uid:"owner-1"},"ENV-DRYRUN-001");
 assert.equal(ownerReport.readOnly,true);
 await ctx.meta.update("envelopes","ENV-DRYRUN-001",{createdBy:undefined,createdByUid:undefined,ownerUid:"owner-1"});
 const aliasReport=await diagnoseFinalisation(ctx,{uid:"owner-1"},"ENV-DRYRUN-001");
 assert.equal(aliasReport.readOnly,true);
 await assert.rejects(()=>diagnoseFinalisation(ctx,{uid:"intruder"},"ENV-DRYRUN-001"),e=>e.status===403);
});
