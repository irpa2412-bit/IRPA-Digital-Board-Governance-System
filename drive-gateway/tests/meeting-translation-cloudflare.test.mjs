import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gateway = readFileSync(new URL("../src/meetingServices.mjs", import.meta.url), "utf8");
const frontend = readFileSync(new URL("../../src/firebase/meetingRecords.js", import.meta.url), "utf8");
const firebaseWorkflow = readFileSync(new URL("../../.github/workflows/firebase-cli-deploy.yml", import.meta.url), "utf8");
const gatewayWorkflow = readFileSync(new URL("../../.github/workflows/cloudflare-gateway-deploy.yml", import.meta.url), "utf8");

test("meeting transcript translation is served by the authenticated Cloudflare Gateway route", () => {
  assert.match(gateway, /\/api\/meeting-transcripts\/translate/);
  assert.match(gateway, /if\(!c\.canRead\)return fail\(ctx,request,"Only an authorised meeting participant or subscriber may translate these proceedings\.",403\)/);
  assert.match(gateway, /content\.length>30000/);
  assert.match(gateway, /new Set\(\["sw","en","fr","es","pt","ar","hi","zh","de","it","ja"\]\)/);
  assert.match(gateway, /https:\/\/translation\.googleapis\.com\/language\/translate\/v2/);
  assert.match(gateway, /MEETING_TRANSCRIPT_TRANSLATED/);
  assert.match(frontend, /callMeetingService\("\/api\/meeting-transcripts\/translate",payload\)/);
});

test("production Firebase workflow no longer deploys the billing-blocked callable", () => {
  assert.doesNotMatch(firebaseWorkflow, /firebase-tools deploy[^\n]*functions:translateMeetingTranscript/);
  assert.match(firebaseWorkflow, /Cloudflare meeting translation architecture/);
  assert.match(firebaseWorkflow, /does not deploy the legacy Firebase callable/);
});

test("Cloudflare Gateway production release runs tests and verifies the protected translation route", () => {
  assert.match(gatewayWorkflow, /Run Cloudflare Gateway tests[\s\S]*?npm test/);
  assert.match(gatewayWorkflow, /Verify production meeting transcript translation route/);
  assert.match(gatewayWorkflow, /api\/meeting-transcripts\/translate/);
  assert.match(gatewayWorkflow, /\$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
});
