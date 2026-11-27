"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const auditSource = fs.readFileSync(
  path.resolve(process.cwd(), "scripts/member-account-compatibility-audit.cjs"),
  "utf8"
);

test("auditor status helper is declared and called consistently", () => {
  assert.match(auditSource, /const activeAuditor\s*=/);
  assert.match(auditSource, /activeAuditor\(auditor\.data\)/);
  assert.doesNotMatch(auditSource, /\bauditorActive\s*\(/);
});

test("account summaries are initialized before being populated", () => {
  assert.match(auditSource, /const memberUsers=new Map\(\),blocked=new Set\(\),loginDenied=new Set\(\),accountSummaries=\[\]/);
  assert.match(auditSource, /accountSummaries\.push\(/);
});

test("member role detection uses only fields recognized by Firestore rules", () => {
  assert.match(auditSource, /const roleValues=\[d\.role,[^\n]*d\.roles[^\n]*d\.assignedRoles[^\n]*d\.selectedRoles[^\n]*\]\.filter\(str\)/);
  assert.doesNotMatch(auditSource, /d\.roleAssignments/);
});

test("legacy member magic-link blocker is limited to incomplete activation", () => {
  assert.match(auditSource, /u&&invitation&&!activeMember\(d\)/);
  assert.match(auditSource, /accountActivated===true&&norm\(d\.registrationStatus\)==="activated"&&Boolean\(d\.activatedAt\)/);
});

test("reason-code counts count distinct accounts rather than duplicate findings", () => {
  assert.match(auditSource, /const categorySets=new Map\(\),reasonAccountSets=new Map\(\)/);
  assert.match(auditSource, /reasonAccountSets\.set\(f\.reasonCode,r\)/);
  assert.match(auditSource, /reasonCodeCounts=Object\.fromEntries\(\[\.\.\.reasonAccountSets\]\.map\(\(\[k,v\]\)=>\[k,v\.size\]\)\)/);
});

test("console and step summary expose only aggregate category/reason-code counts", () => {
  assert.match(auditSource, /const safe=\{categoryCounts,reasonCodeCounts\}/);
  assert.match(auditSource, /ACCOUNT_COMPATIBILITY_DRY_RUN_COUNTS=/);
  const summaryStart = auditSource.indexOf(" const safe={");
  const summaryEnd = auditSource.indexOf("})().catch", summaryStart);
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  const outputSection = auditSource.slice(summaryStart, summaryEnd);
  assert.doesNotMatch(outputSection, /accountRef|recordRef|accountSummaries|email|uid|displayName|name:/i);
});

test("audit script contains no Firebase Auth or Firestore write operations", () => {
  assert.doesNotMatch(auditSource, /(?:db|auth)\.collection\([^)]*\)\.(?:set|update|delete)\s*\(/);
  assert.doesNotMatch(auditSource, /\b(?:createUser|updateUser|deleteUser)\s*\(/);
  assert.doesNotMatch(auditSource, /\b(?:setDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\s*\(/);
});
