import test from "node:test";
import assert from "node:assert/strict";
import {runSocialPlatformAcceptance,SOCIAL_ACCEPTANCE_PLATFORMS} from "../src/utils/socialAcceptanceRunner.js";
test("runner sends separate TEST lifecycle requests for all six platforms",async()=>{
 const calls=[],progress=[];const request=async(path,method,body,timeoutMs)=>{calls.push({path,method,body,timeoutMs});if(method==="POST"&&path==="/api/communications/editorial/items")return {httpStatus:201,data:{item:{id:"id-"+body.platforms[0],title:body.title,status:"Draft",campaignTag:body.campaignTag}}};if(method==="GET")return {httpStatus:200,data:{items:[]}};return {httpStatus:200,data:{item:{status:method==="PATCH"?"Draft":"Approved"}}};};
 const result=await runSocialPlatformAcceptance({request,approvalReason:"Sole administrator verified the TEST content.",runId:"RUN-TEST-1",onStep:(rows,row)=>progress.push(row)});
 assert.equal(result.total,37);assert.equal(result.rows.length,37);assert.equal(result.rows.every(row=>row.status==="PASS"),true);assert.equal(result.items.length,6);assert.equal(calls.filter(x=>x.method==="POST"&&x.path==="/api/communications/editorial/items").length,6);
 for(const p of SOCIAL_ACCEPTANCE_PLATFORMS){const id="id-"+p.id;assert.ok(calls.some(x=>x.path==="/api/communications/editorial/items/"+id&&x.method==="PATCH"));assert.ok(calls.some(x=>x.path==="/api/communications/editorial/items/"+id+"/submit"&&x.method==="POST"));assert.ok(calls.some(x=>x.path==="/api/communications/editorial/items/"+id+"/approve"&&x.method==="POST"&&x.body.reason));assert.ok(calls.some(x=>x.path==="/api/communications/editorial/items/"+id+"/exported"&&x.method==="POST"));}
 assert.ok(calls.every(x=>x.timeoutMs===60000));assert.ok(progress.some(row=>row.status==="RUNNING"));assert.ok(result.items.every(item=>item.id&&item.title.startsWith("TEST ")));
});
test("runner retries failed requests once and reports HTTP detail",async()=>{
 let attempts=0;const request=async(path,method,body)=>{if(method==="POST"&&path==="/api/communications/editorial/items"){attempts++;if(attempts===1)return {httpStatus:503,data:{error:"temporary"}};return {httpStatus:201,data:{item:{id:"recovered-"+attempts,title:body.title,campaignTag:body.campaignTag}}};}if(method==="GET")return {httpStatus:200,data:{items:[]}};return {httpStatus:200,data:{}};};
 const result=await runSocialPlatformAcceptance({request,approvalReason:"Reviewed TEST content for acceptance.",runId:"RUN-RETRY"});assert.equal(attempts,7);assert.ok(result.rows.some(row=>row.name==="Facebook - create TEST item"&&row.status==="PASS"&&row.httpStatus===201));
});
test("failed create marks dependent lifecycle steps failed without inventing item IDs",async()=>{
 const request=async(path,method)=>{if(method==="POST"&&path==="/api/communications/editorial/items")return {httpStatus:403,data:{error:"forbidden"}};if(method==="GET")return {httpStatus:200,data:{items:[]}};return {httpStatus:200,data:{}};};
 const result=await runSocialPlatformAcceptance({request,approvalReason:"Reviewed TEST content for acceptance.",runId:"RUN-FAIL",retries:0});assert.equal(result.rows.length,37);assert.equal(result.rows[0].status,"FAIL");assert.match(result.rows[1].detail,/No TEST item ID/);assert.equal(result.items.length,0);
});