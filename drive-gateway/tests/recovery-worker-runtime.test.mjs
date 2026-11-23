import test from "node:test";
import assert from "node:assert/strict";
import { unstable_dev } from "wrangler";

test("workerd builds 12 verified stamps across source pages 1 and 3 and reports certificate text extraction outcome",async t=>{
  const worker=await unstable_dev("tests/recovery-worker-runtime.worker.mjs",{
    config:"wrangler.recovery-test.toml",local:true,logLevel:"error",
    experimental:{disableExperimentalWarning:true}
  });
  t.after(async()=>{await worker.stop();});
  const response=await worker.fetch("https://worker.test/recovery-runtime");
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.status,200,JSON.stringify(body));
  assert.equal(body.ok,true,JSON.stringify(body));
  assert.equal(body.stampResults.length,12);
  assert.deepEqual(body.stampResults.map(row=>row.page),[1,1,1,1,1,1,3,3,3,3,3,3]);
  assert.equal(body.recordUnchanged,true);
  assert.equal(body.documentUnchanged,true);
  assert.equal(body.accessEventCount,0);
  assert.equal(body.storagePutCalls,1);
  assert.equal(body.downloadedHashMatches,true);
  assert.equal(body.headerHash,body.outputHash);
  assert.ok(body.outputByteLength>0);
  assert.match(body.outputHash,/^[a-f0-9]{64}$/);
  const textStep=body.stages.find(stage=>stage.stageCode==="TEXT_EXTRACT");
  assert.ok(textStep&&["PASS","FAILED"].includes(textStep.status));
  if(textStep.status==="FAILED")assert.ok(textStep.errorClass);
  if(!body.certificateVerified){assert.equal(body.label,"UNARCHIVED COPY. Certificate page not verified. Audit chain, source hash and 12 stamps verified. The envelope is NOT Completed.");assert.match(body.fileName,/UNARCHIVED-COPY-CERTIFICATE-NOT-VERIFIED/);}
  else assert.match(body.fileName,/EMERGENCY-RETRIEVAL-COPY-NOT-ARCHIVED/);
});
