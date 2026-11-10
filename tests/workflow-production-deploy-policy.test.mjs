import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const readWorkflow = path => readFileSync(resolve(ROOT, path), "utf8");
const productionDeployWorkflows = [
  ".github/workflows/cloudflare-production-gateway.yml",
  ".github/workflows/cloudflare-production-gateway-no-secret-sync.yml",
  ".github/workflows/cloudflare-gateway-deploy.yml",
  ".github/workflows/cloudflare-pages-deploy.yml",
  ".github/workflows/firebase-cli-deploy.yml",
  ".github/workflows/firebase-deploy.yml",
  ".github/workflows/grant-crawler-production.yml",
  ".github/workflows/deploy-grant-crawler.yml",
  ".github/workflows/cloudflare-interpreter-deploy.yml",
  ".github/workflows/cloudflare-livekit-secrets.yml"
];

test("production deployment workflows are not triggered by pull requests", () => {
  for (const path of productionDeployWorkflows) {
    const source = readWorkflow(path);
    assert.doesNotMatch(source, /^\s{2}pull_request(?:_target)?:/m, path + " must not deploy from pull_request");
    assert.match(source, /environment:\s*production/, path + " must retain its protected production environment");
  }
});

test("grant crawler PR deployment is restricted to the isolated staging Worker", () => {
  const source = readWorkflow(".github/workflows/grant-crawler-parallel-staging.yml");
  assert.match(source, /^\s{2}pull_request:/m);
  assert.match(source, /github\.event\.pull_request\.head\.repo\.full_name === github\.repository/);
  assert.match(source, /feature\/grant-scanners-mainline/);
  assert.match(source, /feature\/grant-engine-provision-panel/);
  assert.match(source, /wrangler deploy --config wrangler\.toml --env staging/);
  assert.match(source, /name = "irpa-grant-crawler-staging"/);
  assert.match(source, /config\.includes\(\x27irpa-google-drive-gateway\x27\)/, "staging config rejects the production gateway target");
});

test("gateway PR workflow runs local emulator tests; deployment is opt-in and staging-only", () => {
  const source = readWorkflow(".github/workflows/staging-gateway-e2e.yml");
  assert.match(source, /^\s{2}pull_request:/m);
  assert.match(source, /github\.event_name == 'workflow_dispatch' && inputs\.deploy_staging == true/);
  assert.match(source, /environment: staging-repair/);
  assert.match(source, /irpa-google-drive-gateway-staging/);
  assert.doesNotMatch(source, /environment:\s*production/);
});

test("production promotion pull-request gate explicitly remains non-deploying", () => {
  const source = readWorkflow(".github/workflows/production-promotion-gate.yml");
  assert.match(source, /^\s{2}pull_request:/m);
  assert.match(source, /PRODUCTION_PROMOTION_GATE_IS_NON_DEPLOYING=true/);
});
