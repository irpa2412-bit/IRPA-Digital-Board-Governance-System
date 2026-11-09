import test from "node:test";
import assert from "node:assert/strict";
import {SOCIAL_PLATFORMS,validateSocialDraft,inspectSocialText,canTransitionSocialStatus,socialCalendarCsv,socialCalendarRange,socialCalendarDocxXml} from "../src/utils/socialStudioPolicy.js";

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

test("day and week calendar views filter planned items and DOCX XML escapes content",()=>{
 const items=[{title:"Monday",scheduledAt:"2026-11-09T09:00:00",updatedAt:"2026-11-09T10:00:00",platforms:["facebook"],status:"Draft",content:"A & B <C>"},{title:"Next week",scheduledAt:"2026-11-16T09:00:00"}];
 assert.equal(socialCalendarRange(items,"2026-11-09","day").length,1);
 assert.equal(socialCalendarRange(items,"2026-11-09","week").length,1);
 const xml=socialCalendarDocxXml(items.slice(0,1),"2026-11-09","day");
 assert.ok(xml.includes("A &amp; B &lt;C&gt;"));
 assert.ok(xml.includes("Last modified: 2026-11-09T10:00:00"));
});
