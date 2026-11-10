import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = name => fs.readFileSync(path.join(root, name), "utf8");

test("member and employee deployment audit is strictly read-only and aggregate-only", () => {
  const source = read("scripts/audit-deployment-side-effects.mjs");
  assert.match(source, /db\.collection\(collectionName\)\.get\(\)/);
  assert.match(source, /auth\.getUserByEmail\(email\)/);
  assert.match(source, /uidWouldChange/);
  assert.doesNotMatch(source, /\.set\s*\(|\.update\s*\(|\.delete\s*\(|setCustomUserClaims\s*\(/);
  assert.doesNotMatch(source, /console\.(log|warn).*email|console\.(log|warn).*uid|document\.id/);
  assert.match(source, /READ_ONLY/);
});

test("deployment migrations compare existing values before writes and log aggregate counts", () => {
  const source = read("scripts/run-idempotent-deployment-migrations.mjs");
  assert.match(source, /sameFields\(existing\.data\(\), expected\)/);
  assert.match(source, /sameArray\(previous\.irpaRoles, roles\)/);
  assert.match(source, /sameArray\(existing, actionUids\)/);
  assert.match(source, /sameFields\(target\.data\(\), expected\)/);
  for (const label of [
    "PRIMARY_ADMIN_BOOTSTRAP",
    "MEMBER_EMPLOYEE_AND_ROLE_CLAIM_SYNC",
    "SIGNATURE_ENVELOPE_AUTHORIZATION_BACKFILL",
    "SIGNER_PROFILE_MIGRATION"
  ]) assert.ok(source.includes(label), label + " aggregate counts must be logged");
  assert.match(source, /irpa-digital-board-governance/);
});

test("production deployment workflow delegates to the idempotent runner", () => {
  const workflow = read(".github/workflows/firebase-deploy.yml");
  assert.match(workflow, /node scripts\/run-idempotent-deployment-migrations\.mjs/);
  assert.doesNotMatch(workflow, /Backfill signer authorization metadata/);
  assert.doesNotMatch(workflow, /Migrate retained Signature Profiles to Signer Identity records/);
});
