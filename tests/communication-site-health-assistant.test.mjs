import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const portal=read("../src/pages/CommunicationMediaPortal.jsx");
const assistant=read("../src/pages/CommunicationSiteHealthAssistant.jsx");
const workflow=read("../.github/workflows/communication-website-staging-acceptance.yml");

test("site health and assistant are integrated into the authorised communications portal",()=>{
 assert.match(portal,/import CommunicationSiteHealthAssistant from "\.\/CommunicationSiteHealthAssistant"/);
 assert.match(portal,/Site Health & Assistant/);
 assert.match(portal,/websiteEditor&&<CommunicationSiteHealthAssistant/);
 assert.match(assistant,/\/api\/communications\/site\/status/);
 assert.match(assistant,/\/api\/communications\/website\/content\?type=posts/);
 assert.match(assistant,/\/api\/communications\/website\/content\?type=pages/);
});

test("automatic fixes are limited to staging drafts and preserve audit/snapshot gateway workflow",()=>{
 assert.match(assistant,/window\.confirm\(/);
 assert.match(assistant,/item\.status!=="draft"/);
 assert.match(assistant,/workflow:"Draft"/);
 assert.match(assistant,/featuredMedia:Number\(item\.featuredMedia\|\|0\)/);
 assert.match(assistant,/never published automatically|is never published automatically/i);
 assert.doesNotMatch(assistant,/\/api\/communications\/website\/publish/);
 assert.doesNotMatch(assistant,/fetch\(["']https?:\/\/(?:www\.)?irpa\.or\.tz/);
});

test("editorial assistant creates an unsaved draft and does not publish or call an unconfigured AI provider",()=>{
 assert.match(assistant,/AI communications assistant/);
 assert.match(assistant,/does not send data to an AI provider/);
 assert.match(assistant,/Open as an unsaved Workspace draft/);
 assert.match(assistant,/onUseDraft\?\./);
 assert.doesNotMatch(assistant,/window\.open\(/);
});

test("staging build acceptance retains push and manual triggers and does not deploy production",()=>{
 assert.match(workflow,/branches:\s*\n\s*- feature\/communication-media-website-20261025/);
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/cancel-in-progress:\s*false/);
 assert.match(workflow,/npm run build/);
 assert.doesNotMatch(workflow,/wrangler deploy\s*$/m);
});
