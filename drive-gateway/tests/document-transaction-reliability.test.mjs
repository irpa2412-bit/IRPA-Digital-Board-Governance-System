import test from "node:test";
import assert from "node:assert/strict";
import {PDFDocument} from "pdf-lib";
import {memoryMeta,memoryStorage} from "../src/adapters.mjs";
import {handleUpload,handleGetDocumentPdf,runCleanup} from "../src/upload.mjs";
import {route} from "../src/router.mjs";

async function validPdfBytes(){
  const d=await PDFDocument.create();
  d.addPage([300,300]);
  return new Uint8Array(await d.save());
}

function context({meta=memoryMeta(),storage=memoryStorage(),user={uid:"member-1",isAdmin:false}}={}){
  return {
    meta,
    storage,
    verifyUser:async()=>user,
    now:()=>new Date("2026-10-07T18:00:00.000Z"),
    logger:{error:()=>{}}
  };
}

function uploadRequest(bytes,{id="DOC-G4-001",archives=["administrative-documents"],classification="Restricted",name="test.pdf"}={}){
  const form=new FormData();
  form.set("file",new File([bytes],name,{type:"application/pdf"}));
  form.set("documentId",id);
  form.set("title","Gate 4 reliability test");
  form.set("classification",classification);
  for(const archive of archives) form.append("archives",archive);
  return new Request("https://gateway.test/api/documents",{
    method:"POST",
    body:form
  });
}

test("Gate 4: physical PDF upload validates and stores a retrievable document",async()=>{
  const bytes=await validPdfBytes();
  const ctx=context();
  const response=await handleUpload(uploadRequest(bytes),ctx);
  assert.equal(response.status,201);
  const result=await response.json();
  assert.equal(result.ok,true);
  assert.equal(result.documentId,"DOC-G4-001");
  assert.equal(result.size,bytes.length);
  assert.equal(result.archives.length,1);

  const stored=await ctx.meta.get("documents","DOC-G4-001");
  assert.equal(stored.status,"Stored");
  assert.equal(stored.archives.length,1);
  assert.equal(stored.primaryStorageId,stored.archives[0].id);
  assert.equal(stored.hash,result.sha256);

  const retrieved=await handleGetDocumentPdf(
    new Request("https://gateway.test/api/documents/DOC-G4-001/pdf"),
    ctx,
    "DOC-G4-001"
  );
  assert.equal(retrieved.status,200);
  assert.equal(retrieved.headers.get("x-document-sha256"),result.sha256);
  assert.deepEqual(new Uint8Array(await retrieved.arrayBuffer()),bytes);
});

test("Gate 4: multi-channel storage preserves every selected archive",async()=>{
  const bytes=await validPdfBytes();
  const ctx=context();
  const response=await handleUpload(uploadRequest(bytes,{
    id:"DOC-G4-002",
    archives:["finance","administrative-documents","board-governance"]
  }),ctx);
  assert.equal(response.status,201);

  const stored=await ctx.meta.get("documents","DOC-G4-002");
  assert.equal(stored.archives.length,3);
  assert.deepEqual(
    stored.archives.map(x=>x.archiveKey),
    ["finance","administrative-documents","board-governance"]
  );
  assert.equal(ctx.storage.objs.size,3);
});

test("Gate 4: interrupted/invalid physical upload is rejected before persistence",async()=>{
  const bytes=new Uint8Array([1,2,3,4]);

  const handlerCtx=context();
  await assert.rejects(
    () => handleUpload(
      uploadRequest(bytes,{id:"DOC-G4-003",name:"broken.pdf"}),
      handlerCtx
    ),
    error=>{
      assert.equal(error.status,400);
      assert.equal(error.message,"The uploaded file is not a valid PDF.");
      return true;
    }
  );
  assert.equal(await handlerCtx.meta.get("documents","DOC-G4-003"),null);
  assert.equal(handlerCtx.storage.objs.size,0);

  const httpResponse=await route(
    uploadRequest(bytes,{id:"DOC-G4-003",name:"broken.pdf"}),
    context()
  );
  assert.equal(httpResponse.status,400);
});

test("Gate 4: storage failure rolls back already-written objects and metadata",async()=>{
  const bytes=await validPdfBytes();

  const handlerStorage=memoryStorage();
  handlerStorage.failPutWhen=n=>n===2;
  const handlerCtx=context({storage:handlerStorage});
  await assert.rejects(
    () => handleUpload(uploadRequest(bytes,{
      id:"DOC-G4-004",
      archives:["finance","human-resources","legal-contracts"]
    }),handlerCtx),
    error=>{
      assert.equal(error.status,502);
      assert.equal(error.message,"Storage failed; nothing was saved.");
      return true;
    }
  );
  assert.equal(handlerStorage.objs.size,0);
  assert.equal(await handlerCtx.meta.get("documents","DOC-G4-004"),null);
  assert.equal((await handlerCtx.meta.list("pendingCleanup")).length,0);

  const httpStorage=memoryStorage();
  httpStorage.failPutWhen=n=>n===2;
  const httpResponse=await route(
    uploadRequest(bytes,{
      id:"DOC-G4-004",
      archives:["finance","human-resources","legal-contracts"]
    }),
    context({storage:httpStorage})
  );
  assert.equal(httpResponse.status,502);
  assert.deepEqual(await httpResponse.json(),{ok:false,error:"Storage failed; nothing was saved."});
});

test("Gate 4: rollback deletion failure creates durable cleanup work",async()=>{
  const bytes=await validPdfBytes();
  const storage=memoryStorage();
  storage.failPutWhen=n=>n===2;
  storage.failDelete=true;
  const ctx=context({storage});

  await assert.rejects(
    () => handleUpload(uploadRequest(bytes,{
      id:"DOC-G4-005",
      archives:["finance","human-resources"]
    }),ctx),
    error=>{
      assert.equal(error.status,502);
      assert.equal(error.message,"Storage failed; nothing was saved.");
      return true;
    }
  );
  assert.equal(await ctx.meta.get("documents","DOC-G4-005"),null);
  const pending=await ctx.meta.list("pendingCleanup");
  assert.equal(pending.length,1);
  assert.match(pending[0].storageId,/^mem-/);
  assert.equal(storage.objs.size,1);

  storage.failDelete=false;
  const cleanup=await runCleanup(ctx);
  assert.deepEqual(cleanup,{removed:1});
  assert.equal(storage.objs.size,0);
  assert.equal((await ctx.meta.list("pendingCleanup")).length,0);

  const httpStorage=memoryStorage();
  httpStorage.failPutWhen=n=>n===2;
  httpStorage.failDelete=true;
  const httpResponse=await route(
    uploadRequest(bytes,{
      id:"DOC-G4-005",
      archives:["finance","human-resources"]
    }),
    context({storage:httpStorage})
  );
  assert.equal(httpResponse.status,502);
});

test("Gate 4: duplicate document IDs do not overwrite an existing document",async()=>{
  const bytes=await validPdfBytes();
  const ctx=context();

  assert.equal(
    (await route(uploadRequest(bytes,{id:"DOC-G4-006"}),ctx)).status,
    201
  );
  const second=await route(uploadRequest(bytes,{id:"DOC-G4-006"}),ctx);
  assert.equal(second.status,409);

  const stored=await ctx.meta.get("documents","DOC-G4-006");
  assert.equal(stored.status,"Stored");
  assert.equal(ctx.storage.objs.size,1);
});

test("Gate 4: retrieval detects stored-document tampering",async()=>{
  const bytes=await validPdfBytes();
  const ctx=context();
  assert.equal((await handleUpload(uploadRequest(bytes,{id:"DOC-G4-007"}),ctx)).status,201);
  const stored=await ctx.meta.get("documents","DOC-G4-007");
  const object=ctx.storage.objs.get(stored.primaryStorageId);
  object.bytes[object.bytes.length-1]^=1;

  await assert.rejects(
    () => handleGetDocumentPdf(
      new Request("https://gateway.test/api/documents/DOC-G4-007/pdf"),
      ctx,
      "DOC-G4-007"
    ),
    error=>{
      assert.equal(error.status,500);
      assert.equal(error.message,"Integrity check failed.");
      return true;
    }
  );
});
