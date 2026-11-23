import test from "node:test";
import assert from "node:assert/strict";
import { unstable_dev } from "wrangler";

test("workerd builds 12 verified stamps across source pages 1 and 3 and reports certificate text extraction outcome",async t=>{
  const worker=await unstable_dev("tests/recovery-worker-runtime.worker.mjs",{
    config:"wrangler.toml",local:true,logLevel:"error",
    experimental:{disableExperimentalWarning:true}
  });
  t.after(async()=>{await worker.stop();});
  const response=await worker.fetch("https://worker.test/recovery-runtime");
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.ok,true,JSON.stringify(body));
  assert.equal(body.stampResults.length,12);
  assert.deepEqual(body.stampResults.map(row=>row.page),[1,1,1,1,1,1,3,3,3,3,3,3]);
  assert.equal(body.recordUnchanged,true);
  assert.ok(body.outputByteLength>0);
  assert.match(body.outputHash,/^[a-f0-9]{64}$/);
  assert.ok(body.stages.some(stage=>stage.stageCode==="TEXT_EXTRACT"&&stage.status==="FAILED"&&stage.failureCode==="TEXT_EXTRACT")||body.stages.some(stage=>stage.stageCode==="CERT_VERIFY"&&["PASS","FAILED"].includes(stage.status)));
});
