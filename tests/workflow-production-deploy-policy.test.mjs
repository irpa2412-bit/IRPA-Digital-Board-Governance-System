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

test("production Firebase data mutations and Functions deployments require explicit owner dispatch approval", () => {
  const source = readWorkflow(".github/workflows/firebase-deploy.yml");
  assert.match(source, /authorize_production_data_migration:[\s\S]*?default: "no"/);
  assert.doesNotMatch(source, /authorize_production_functions_deployment/);
  for (const step of [
    "Deploy login authorization resolver",
    "Deploy retained Firebase password-reset function",
    "Deploy actual-data access control callables",
    "Deploy signed meeting attendance register callables"
  ]) {
    assert.equal(source.indexOf("- name: " + step), -1, step + " must not be deployed as a Firebase Function");
  }
  assert.doesNotMatch(source, /--only\\s+[^\\n]*functions:/);
  assert.match(source, /- name: Deploy Firebase Hosting independently/);
});



test("dedicated production Firestore rules workflow requires exact DEPLOY RULES confirmation", () => {
  const source = readWorkflow(".github/workflows/firestore-production-no-billing.yml");
  assert.match(source, /confirm_production_firestore_rules_deployment:[\\s\\S]*?type: string/);
  assert.match(source, /CONFIRMATION/);
  assert.match(source, /DEPLOY RULES/);
  assert.match(source, /inputs\\.confirm_production_firestore_rules_deployment == 'DEPLOY RULES'/);
  assert.match(source, /--only firestore:rules,firestore:indexes/);
  assert.match(source, /environment: production/);
});

test("isolated staging Firestore rules publisher requires manual DEPLOY RULES confirmation", () => {
  const source = readWorkflow(".github/workflows/publish-staging-firestore-rules-only.yml");
  assert.match(source, /^\s{2}workflow_dispatch:/m);
  assert.doesNotMatch(source, /^\s{2}push:/m);
  assert.match(source, /inputs\.confirm_staging_firestore_rules_deployment == 'DEPLOY RULES'/);
});


test("staging Gateway E2E rules publisher requires exact manual DEPLOY RULES confirmation", () => {
  const source = readWorkflow(".github/workflows/staging-gateway-e2e.yml");
  assert.match(source, /confirm_staging_firestore_rules_deployment:[\s\S]*?default: "no"/);
  const start = source.indexOf("- name: Deploy approved Firestore rules to isolated staging only");
  assert.ok(start >= 0);
  const next = source.indexOf("\n      - name:", start + 1);
  assert.match(source.slice(start, next < 0 ? source.length : next), /github\.event_name == 'workflow_dispatch'.*inputs\.confirm_staging_firestore_rules_deployment == 'DEPLOY RULES'/);
});

test("LiveKit staging frontend rules publisher requires exact manual DEPLOY RULES confirmation", () => {
  const source = readWorkflow(".github/workflows/cloudflare-livekit-staging-frontend.yml");
  assert.match(source, /confirm_staging_firestore_rules_deployment:[\s\S]*?default: "no"/);
  const start = source.indexOf("- name: Deploy committed Firestore rules to the isolated staging project only");
  assert.ok(start >= 0);
  const next = source.indexOf("\n      - name:", start + 1);
  assert.match(source.slice(start, next < 0 ? source.length : next), /github\.event_name == 'workflow_dispatch'.*inputs\.confirm_staging_firestore_rules_deployment == 'DEPLOY RULES'/);
});
test("Firebase deployment workflow does not assert Cloudflare build identity", () => {
  const source = readWorkflow(".github/workflows/firebase-deploy.yml");
  assert.match(source, /Verify live Firebase Hosting independently/);
  assert.match(source, /firebase-hosting-live/);
  assert.doesNotMatch(source, /cloudflare\/frontend-live/);
  assert.doesNotMatch(source, /CLOUDFLARE_LIVE_OK/);
  assert.doesNotMatch(source, /Verify live Cloudflare production frontend independently/);
});

test("production deployment workflows are not triggered by pull requests", () => {
  for (const path of productionDeployWorkflows) {
    const source = readWorkflow(path);
    assert.doesNotMatch(source, /^\s{2}pull_request(?:_target)?:/m, path + " must not deploy from pull_request");
    assert.match(source, /environment:\s*(?:production|irpa-grant-crawler-production)/, path + " must retain its protected production environment");
  }
});

test("production Firebase CLI rules require explicit yes and Worker deployment retains its separate owner approval", () => {
  const source = readWorkflow(".github/workflows/firebase-cli-deploy.yml");
  assert.match(source, /confirm_production_firestore_rules_deployment:[\s\S]*?type: choice[\s\S]*?options:[\s\S]*?- "no"[\s\S]*?- "yes"[\s\S]*?default: "no"/);
  assert.match(source, /authorize_production_worker_deployment:[\s\S]*?default: "no"/);
  const workerStart = source.indexOf("- name: Deploy grant crawler to Cloudflare Workers");
  const rulesStart = source.indexOf("- name: Deploy Firestore Rules and Indexes");
  const fallbackRulesStart = source.indexOf("- name: Deploy Firestore only while crawler cutover is blocked");
  assert.ok(workerStart >= 0 && rulesStart > workerStart && fallbackRulesStart > rulesStart);
  const workerEnd = source.indexOf("\n      - name:", workerStart + 1);
  const rulesEnd = source.indexOf("\n      - name:", rulesStart + 1);
  const fallbackRulesEnd = source.indexOf("\n      - name:", fallbackRulesStart + 1);
  assert.match(source.slice(workerStart, workerEnd), /inputs\.authorize_production_worker_deployment == 'yes'/);
  assert.match(source.slice(rulesStart, rulesEnd), /if: steps\.cloudflare_gate\.outcome == 'success' && github\.event_name == 'workflow_dispatch' && inputs\.confirm_production_firestore_rules_deployment == 'yes'/);
  assert.match(source.slice(fallbackRulesStart, fallbackRulesEnd), /if: steps\.cloudflare_gate\.outcome != 'success' && github\.event_name == 'workflow_dispatch' && inputs\.confirm_production_firestore_rules_deployment == 'yes'/);
  assert.match(source, /wrangler deploy --config cloudflare\/grant-crawler\/wrangler\.toml/);
  assert.match(source, /wrangler --config cloudflare\/grant-crawler\/wrangler\.toml secret put FIREBASE_SERVICE_ACCOUNT_JSON/);
  assert.doesNotMatch(source, /working-directory: cloudflare\/grant-crawler/);
});

test("grant crawler PR deployment is restricted to the isolated staging Worker", () => {
  const source = readWorkflow(".github/workflows/grant-crawler-parallel-staging.yml");
  assert.match(source, /^\s{2}pull_request:/m);
  assert.match(source, /github\.event\.pull_request\.head\.repo\.full_name\s*={2,3}\s*github\.repository/);
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
test("draft pull requests cannot create production-promotion proof tags", () => {
  const source = readWorkflow(".github/workflows/production-promotion-gate.yml");
  assert.match(source, /types: \[opened, synchronize, reopened, ready_for_review\]/);
  assert.match(source, /candidate-proof:\s*\n\s+if: github\.event\.pull_request\.draft == false/);
  assert.match(source, /gate-proof:\s*\n\s+if: github\.event\.pull_request\.draft == false/);
  assert.match(source, /git push origin "refs\/tags\/\$TAG_NAME"/);
});


test("production Gateway deployment requires SMTP_PASSWORD secret and configures the IRPA sender",()=>{
  const source=readWorkflow(".github/workflows/cloudflare-gateway-deploy.yml");
  assert.match(source,/smtpPasswordBindings = bindings\.filter\(b => b\.name === "SMTP_PASSWORD"\)/);
  assert.match(source,/smtpPasswordBindings\.length !== 1 \|\| smtpPasswordBindings\[0\]\?\.type !== "secret_text"/);
  const gateway=readFileSync(resolve(ROOT,"drive-gateway/src/index.js"),"utf8");
  const mailRoute=readFileSync(resolve(ROOT,"drive-gateway/src/invitationEmail.mjs"),"utf8");
  assert.match(gateway,/emailDeliveryService: payload\.irpaEmailDeliveryService === true/);
  assert.match(mailRoute,/claims\?\.user_id !== "irpa-email-dispatcher"/);
  assert.match(mailRoute,/claims\?\.firebaseClaims\?\.emailDeliveryService !== true/);
  assert.doesNotMatch(source,/INVITE_SERVICE_KEY/);
  assert.match(mailRoute,/x-irpa-service-key/);
  assert.match(source,/SMTP_HOST: "mail\.irpa\.or\.tz"/);
  assert.match(source,/SMTP_PORT: "465"/);
  assert.match(source,/SMTP_FROM: "info@irpa\.or\.tz"/);
  assert.match(source,/deploy --keep-vars/);
});
