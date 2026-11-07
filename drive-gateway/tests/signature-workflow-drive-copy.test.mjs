import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ensureVerifiedSignatureWorkflowPdfCopy } from "../src/signatureWorkflowDrive.mjs";

const bytes=new TextEncoder().encode("%PDF-1.7\nIRPA test PDF");
const sha=createHash("sha256").update(bytes).digest("hex");
function fixture({copyExists=false,copyMime="application/pdf",copyParent="folder"}={}) {
  const state={copyExists,copyMime,copyParent,copyCount:0,folders:[]};
  const metadata=(id,mimeType,parent,description,appProperties)=>({id,name:id==="source"?"source.pdf":"IRPA-ENVELOPE-ENV-001.pdf",mimeType,size:String(bytes.length),parents:[parent],description:JSON.stringify(description||{}),appProperties:appProperties||{},trashed:false});
  const appProperties={irpaEnvelopeId:"ENV-001",irpaDocumentId:"DOC-1",irpaSourceFileId:"source",irpaSourceSha256:sha};
  const description={irpaGovernance:true,irpaSignatureWorkflowCopy:true,envelopeId:"ENV-001",documentId:"DOC-1",ownerUid:"owner",sourceFileId:"source",sourceSha256:sha};
  const driveFetch=async(path,options={})=>{
    if(path.includes("/copy?")){state.copyCount++;state.copyExists=true;return metadata("copy", "application/pdf","folder",description,appProperties);}
    if(path.startsWith("/drive/v3/files?q="))return {files:state.copyExists?[metadata("copy",state.copyMime,state.copyParent,description,appProperties)]:[]};
    if(path.includes("/source?"))return metadata("source","application/pdf","source-folder",{});
    if(path.includes("/copy?")===false&&path.includes("/copy"))return metadata("copy",state.copyMime,state.copyParent,description,appProperties);
    if(path.includes("/copy"))return metadata("copy",state.copyMime,state.copyParent,description,appProperties);
    if(path.includes("/files/source"))return metadata("source","application/pdf","source-folder",{});
    if(path.includes("/files/copy"))return metadata("copy",state.copyMime,state.copyParent,description,appProperties);
    throw new Error("Unexpected Drive path "+path);
  };
  return {state,driveFetch,findOrCreateFolder:async(name)=>{state.folders.push(name);return name==="IRPA-WORKFLOW-ENV-001"?"folder":name;},downloadBytes:async()=>bytes,hashBytes:async(value)=>createHash("sha256").update(value).digest("hex")};
}
const input={envelopeId:"ENV-001",documentId:"DOC-1",sourceFileId:"source",sourceSha256:sha,sourceByteLength:bytes.length,ownerUid:"owner",accessToken:"token",getRootFolderName:()=>"IRPA Governance System"};

test("creates and verifies a PDF copy in the envelope folder",async()=>{
 const f=fixture();
 const result=await ensureVerifiedSignatureWorkflowPdfCopy({...input,...f});
 assert.equal(result.folderId,"folder");
 assert.equal(result.mimeType,"application/pdf");
 assert.equal(result.copiedSha256,sha);
 assert.equal(f.state.copyCount,1);
});
test("retry reuses and verifies an existing Drive copy without duplicating it",async()=>{
 const f=fixture({copyExists:true});
 const result=await ensureVerifiedSignatureWorkflowPdfCopy({...input,...f});
 assert.equal(result.fileId,"copy");
 assert.equal(f.state.copyCount,0);
});
test("rejects a copy outside the expected parent folder",async()=>{
 const f=fixture({copyExists:true,copyParent:"wrong-folder"});
 await assert.rejects(()=>ensureVerifiedSignatureWorkflowPdfCopy({...input,...f}),/parent-folder/);
});
test("rejects a non-PDF copy",async()=>{
 const f=fixture({copyExists:true,copyMime:"application/octet-stream"});
 await assert.rejects(()=>ensureVerifiedSignatureWorkflowPdfCopy({...input,...f}),/parent-folder/);
});
