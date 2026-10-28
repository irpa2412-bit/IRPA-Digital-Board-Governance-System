import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const workflow = read("../.github/workflows/scheduled-website-health-maintenance.yml");
const script = read("../scripts/staging-website-health-maintenance.mjs");
const assistant = read("../src/pages/CommunicationSiteHealthAssistant.jsx");

test("scheduled health maintenance runs every two days and only targets staging", () => {
  assert.match(workflow, /cron:\s*["']17 5 \*\/2 \* \*["']/);
  assert.match(workflow, /STAGING_GATEWAY_URL:\s*https:\/\/irpa-google-drive-gateway-staging\.irpa-governance\.workers\.dev/);
  assert.match(workflow, /STAGING_WORDPRESS_BASE_URL:\s*\$\{\{ secrets\.STAGING_WORDPRESS_BASE_URL \}\}/);
  assert.match(script, /url\.hostname !== "staging\.irpa\.or\.tz"/);
  assert.match(script, /no content or configuration mutations/i);
  assert.doesNotMatch(workflow, /wrangler deploy|wp plugin update|wp core update/i);
});

test("scheduled maintenance is read-only, retries transient checks and never publishes content", () => {
  assert.match(script, /attempts = 3/);
  assert.match(script, /\/api\/communications\/site\/status/);
  assert.match(script, /\/api\/communications\/website\/content\?type=/);
  assert.doesNotMatch(script, /method:\s*["']PUT|method:\s*["']PATCH|method:\s*["']DELETE|\/website\/publish/);
  assert.match(workflow, /Human approval remains required for content changes/);
});

test("content metadata changes in the editor require an explicit human confirmation", () => {
  assert.match(assistant, /window\.confirm\(/);
  assert.match(assistant, /Apply safe fixes to draft items/);
  assert.match(assistant, /workflow:"Draft"/);
  assert.match(assistant, /never published automatically/i);
});
