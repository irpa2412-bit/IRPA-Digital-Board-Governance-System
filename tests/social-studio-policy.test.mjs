import test from "node:test";
import assert from "node:assert/strict";
import {SOCIAL_PLATFORMS,validateSocialDraft,inspectSocialText,canTransitionSocialStatus,socialCalendarCsv} from "../src/utils/socialStudioPolicy.js";

test("platform text and hashtag limits are enforced",()=>{
 assert.ok(validateSocialDraft({title:"T",body:"x".repeat(281),platforms:["x"]}).some(x=>x.includes("280")));
 assert.ok(validateSocialDraft({title:"T",body:"Update",hashtags:"#a #b #c #d #e #f",platforms:["linkedin"]}).some(x=>x.includes("5 hashtags")));
 assert.equal(SOCIAL_PLATFORMS.instagram.imageBytes,30*1024*1024);
});
test("HTTPS links and mandatory media alt text are validated",()=>{
 assert.ok(validateSocialDraft({title:"T",body:"Text",platforms:["facebook"],link:"http://example.org"}).some(x=>x.includes("HTTPS")));
 assert.ok(validateSocialDraft({title:"T",body:"Text",platforms:["facebook"],mediaUrl:"https://example.org/a.jpg"}).some(x=>x.includes("Alternative text")));
});
test("sensitive content warnings detect credentials, private contacts and confidential markers",()=>{
 assert.ok(inspectSocialText("password: abc").length);
 assert.ok(inspectSocialText("Call +255 712 345 678").length);
 assert.ok(inspectSocialText("Confidential project record").length);
});
test("status flow requires a different approver or administrator",()=>{
 assert.equal(canTransitionSocialStatus("Draft","In review"),true);
 assert.equal(canTransitionSocialStatus("In review","Approved",{isAuthor:true,secondApprover:true}),false);
 assert.equal(canTransitionSocialStatus("In review","Approved",{isAdmin:true,isAuthor:true}),false);
 assert.equal(canTransitionSocialStatus("In review","Approved",{secondApprover:true,isAuthor:false}),true);
 assert.equal(canTransitionSocialStatus("Approved","Exported"),true);
});
test("calendar CSV quotes fields and preserves embedded commas",()=>{
 const csv=socialCalendarCsv([{title:"A, B",platforms:["facebook"],status:"Draft"}]);
 assert.match(csv,/"A, B"/);
});
