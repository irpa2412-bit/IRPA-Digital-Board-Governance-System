import test from "node:test";
import assert from "node:assert/strict";
import {memoryMeta,memoryStorage} from "../src/adapters.mjs";
import {retryCompletion,undoFinalisationRetry,verifyChain} from "../src/signing.mjs";
import {assessRecoveryEvidence} from "../src/signatureRecovery.mjs";
import {sha256Hex} from "../src/util.mjs";

const baseTime="2026-11-22T18:00:00.000Z";
function makeEnvelope(id="ENV-RETRY-001",ownerField="createdBy"){
 return {id,[ownerField]:"owner-1",status:"CompletionFailed",documentId:"DOC-MISSING",documentHash:"a".repeat(64),title:"Court session record",fileName:"court-session.pdf",archiveTargets:[],events:[],completionFailure:{stage:"ARCHIVE",stageCode:"ARCHIVE",failedAt:"2026-11-22T17:00:00.000Z"},signers:[{id:"S1",name:"Test Signer",email:"private.signer@example.org",status:"Signed",signedAt:"2026-11-22T10:00:00.000Z",signatureValue:"data:image/png;base64,SIGNATURE_SECRET",signingUrl:"https://private.example.org/sign?token=secret",tokenHash:"TOKEN_HASH_SECRET",emailLinkSessionHash:"SESSION_HASH_SECRET",fieldValues:{SIG:"data:image/png;base64,STAMP_SECRET",DATE:"2026-11-22"}}],fields:[]};
}
async function fixture({id="ENV-RETRY-001",ownerField="createdBy",now=baseTime}={}){
 const meta=memoryMeta(),storage=memoryStorage(),envelope=makeEnvelope(id,ownerField);
 await meta.create("envelopes",id,envelope);
 const ctx={meta,storage,env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test"},now:()=>new Date(now),logger:{error(){}}};
 return{meta,storage,envelope,ctx,owner:{uid:"owner-1"},admin:{uid:"admin-1",isAdmin:true},outsider:{uid:"outsider"}};
}
test("retry requires an explicit one-attempt confirmation and owner/admin authority",async()=>{
 const f=await fixture();
 await assert.rejects(()=>retryCompletion(f.ctx,f.owner,f.envelope.id),e=>e.status===400);
 await assert.rejects(()=>retryCompletion(f.ctx,f.outsider,f.envelope.id,{confirmOneRetry:true}),e=>e.status===403);
 assert.equal(await f.meta.get("finalisationRetryBackups",f.envelope.id),null);
});
test("retry backs up first, strips images and token material, runs normal finalisation once and records the failing stage",async()=>{
 const f=await fixture();
 const result=await retryCompletion(f.ctx,f.owner,f.envelope.id,{confirmOneRetry:true});
 assert.equal(result.completed,false);
 assert.equal(result.failure.stageCode,"READ_ORIGINAL");
 const backup=await f.meta.get("finalisationRetryBackups",f.envelope.id);
 assert.ok(backup.createdAt);
 assert.equal(backup.envelopeSnapshot.signers[0].signatureValue,undefined);
 assert.equal(backup.envelopeSnapshot.signers[0].tokenHash,undefined);
 assert.equal(backup.envelopeSnapshot.signers[0].emailLinkSessionHash,undefined);
 assert.equal(backup.envelopeSnapshot.signers[0].signingUrl,undefined);
 assert.equal(backup.envelopeSnapshot.signers[0].fieldValues.SIG,undefined);
 assert.equal(backup.envelopeSnapshot.signers[0].fieldValues.DATE,"2026-11-22");
 const after=await f.meta.get("envelopes",f.envelope.id);
 assert.equal(after.status,"CompletionFailed");
 assert.equal(after.signers[0].signatureValue,"data:image/png;base64,SIGNATURE_SECRET");
 assert.equal(after.signers[0].tokenHash,"TOKEN_HASH_SECRET");
 assert.equal(after.finalisationRecord.stages.READ_ORIGINAL.status,"FAILED");
 assert.equal(after.finalisationRecord.stages.READ_ORIGINAL.attemptId,result.retry.attemptId);
 assert.equal(after.events.some(event=>event.type==="envelope.finalisation.retry.started"),true);
 assert.equal(after.events.some(event=>event.type==="envelope.finalisation.retry.failed"&&event.stageCode==="READ_ORIGINAL"),true);
 assert.equal(await verifyChain(after.events),true);
});
test("a second retry on the same envelope is blocked",async()=>{
 const f=await fixture();
 await retryCompletion(f.ctx,f.owner,f.envelope.id,{confirmOneRetry:true});
 await assert.rejects(()=>retryCompletion(f.ctx,f.owner,f.envelope.id,{confirmOneRetry:true}),e=>e.status===409);
});
test("failed retry can be undone within seven days without changing signer evidence or erasing stage history",async()=>{
 const f=await fixture();
 await retryCompletion(f.ctx,f.owner,f.envelope.id,{confirmOneRetry:true});
 const undone=await undoFinalisationRetry(f.ctx,f.owner,f.envelope.id);
 const after=await f.meta.get("envelopes",f.envelope.id);
 const attempt=await f.meta.get("finalisationRetryAttempts",f.envelope.id);
 assert.equal(undone.status,"UNDONE");
 assert.equal(after.status,"CompletionFailed");
 assert.equal(after.completionFailure.stage,"ARCHIVE");
 assert.equal(after.signers[0].signatureValue,"data:image/png;base64,SIGNATURE_SECRET");
 assert.equal(after.finalisationRecord.stages.READ_ORIGINAL.status,"FAILED");
 assert.equal(after.finalisationRetry.status,"UNDONE");
 assert.equal(attempt.status,"UNDONE");
 assert.equal(await verifyChain(after.events),true);
});
test("three attempts per actor per hour are enforced across envelopes",async()=>{
 const f=await fixture();
 for(let i=1;i<=3;i++){
  const id="ENV-RATE-"+i;
  await f.meta.create("envelopes",id,makeEnvelope(id));
  const result=await retryCompletion(f.ctx,f.owner,id,{confirmOneRetry:true});
  assert.equal(result.retry.status,"FAILED");
 }
 const fourth="ENV-RATE-4";
 await f.meta.create("envelopes",fourth,makeEnvelope(fourth));
 await assert.rejects(()=>retryCompletion(f.ctx,f.owner,fourth,{confirmOneRetry:true}),e=>e.status===429);
});
test("administrator can perform a controlled retry for another owner's failed envelope",async()=>{
 const f=await fixture({ownerField:"ownerUid"});
 const result=await retryCompletion(f.ctx,f.admin,f.envelope.id,{confirmOneRetry:true});
 assert.equal(result.retry.status,"FAILED");
});
test("evidence report data exposes only masked signer addresses and EAT signing times",async()=>{
 const meta=memoryMeta(),storage=memoryStorage(),bytes=new Uint8Array([1,2,3]),hash=await sha256Hex(bytes);
 const envelope=makeEnvelope("ENV-EVIDENCE-001");
 envelope.documentId="DOC-EVIDENCE-001";envelope.documentHash=hash;envelope.events=[];
 const source=await storage.put({path:"source",bytes,contentType:"application/pdf",metadata:{}});
 await meta.create("documents",envelope.documentId,{id:envelope.documentId,primaryStorageId:source.id,sha256:hash});
 await meta.create("envelopes",envelope.id,envelope);
 const ctx={meta,storage,env:{IRPA_ENVIRONMENT:"test"},now:()=>new Date(baseTime)};
 const report=await assessRecoveryEvidence(ctx,{uid:"owner-1"},envelope.id);
 assert.equal(report.signers[0].maskedAddress,"p***@e***.org");
 assert.equal(report.signers[0].signedAtEAT,"2026-11-22 13:00:00 EAT");
 assert.equal(report.signers[0].email,undefined);
});

test("undo expires after seven days and cannot reverse a completed document",async()=>{
 const f=await fixture();
 await retryCompletion(f.ctx,f.owner,f.envelope.id,{confirmOneRetry:true});
 f.ctx.now=()=>new Date("2026-12-01T18:00:00.000Z");
 await assert.rejects(()=>undoFinalisationRetry(f.ctx,f.owner,f.envelope.id),e=>e.status===410);
 const current=await f.meta.get("envelopes",f.envelope.id);
 await f.meta.update("envelopes",f.envelope.id,{status:"Completed"},{ifVersion:current._v});
 await assert.rejects(()=>undoFinalisationRetry(f.ctx,f.owner,f.envelope.id),e=>e.status===409);
});
