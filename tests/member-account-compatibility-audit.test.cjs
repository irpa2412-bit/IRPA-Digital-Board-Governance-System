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


test("mocked Auth and Firestore audit completes without a ReferenceError or remote writes", () => {
  const { execFileSync } = require("node:child_process");
  const os = require("node:os");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "irpa-member-audit-"));
  const functionsDir = path.join(tempRoot, "functions");
  fs.mkdirSync(functionsDir, { recursive: true });
  fs.writeFileSync(path.join(functionsDir, "package.json"), '{"private":true}\n');

  const mockPath = path.join(tempRoot, "mock-firebase-admin.cjs");
  const mockCode = String.raw`"use strict";
const Module = require("node:module");
const originalLoad = Module._load;
const fixtureUser = {
  uid: "fixture-member-uid",
  email: "fixture-member@example.test",
  disabled: false,
  customClaims: {}
};
const fixtureDocs = {
  members: [{
    id: "fixture-member-uid",
    data: {
      uid: "fixture-member-uid",
      email: "fixture-member@example.test",
      role: "Member",
      status: "Active",
      registrationStatus: "Activated",
      accountActivated: true,
      activatedAt: "2026-11-27T00:00:00.000Z",
      invitationId: "fixture-invitation"
    }
  }],
  invitations: [{
    id: "fixture-invitation",
    data: {
      email: "fixture-member@example.test",
      status: "Activated",
      acceptedUid: "fixture-member-uid"
    }
  }],
  adminProfiles: [],
  employees: [],
  auditorProfiles: [],
  signatureProfiles: [{
    id: "fixture-member-uid",
    data: {
      uid: "fixture-member-uid",
      email: "fixture-member@example.test",
      status: "Active"
    }
  }],
  signerIdentities: []
};
Module._load = function(request, parent, isMain) {
  if (request === "firebase-admin/app") {
    return { initializeApp() {}, cert(value) { return value; } };
  }
  if (request === "firebase-admin/auth") {
    return { getAuth() { return { async listUsers() { return { users: [fixtureUser] }; } }; } };
  }
  if (request === "firebase-admin/firestore") {
    return {
      getFirestore() {
        return {
          collection(name) {
            return {
              async get() {
                const entries = fixtureDocs[name] || [];
                return {
                  docs: entries.map(entry => ({
                    id: entry.id,
                    data() { return entry.data; }
                  }))
                };
              }
            };
          }
        };
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
`;
  fs.writeFileSync(mockPath, mockCode);
  const summaryPath = path.join(tempRoot, "step-summary.md");
  const scriptPath = path.resolve(process.cwd(), "scripts/member-account-compatibility-audit.cjs");
  try {
    const stdout = execFileSync(process.execPath, ["--require", mockPath, scriptPath], {
      cwd: tempRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: "irpa-digital-board-governance" }),
        GITHUB_STEP_SUMMARY: summaryPath
      }
    });
    assert.match(stdout, /AUDIT_COMPLETE/);
    assert.match(stdout, /ACCOUNT_COMPATIBILITY_DRY_RUN_COUNTS=/);
    assert.doesNotMatch(stdout, /ReferenceError|fixture-member|fixture@example/);
    const summary = fs.readFileSync(summaryPath, "utf8");
    assert.match(summary, /Accounts by category/);
    assert.match(summary, /Findings by reason code/);
    assert.doesNotMatch(summary, /fixture-member|fixture@example|uid|email/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("owner report encryption uses RSA-OAEP and AES-256-GCM and removes plaintext", () => {
  const { execFileSync } = require("node:child_process");
  const os = require("node:os");
  const crypto = require("node:crypto");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "irpa-owner-report-"));
  const input = path.join(tempRoot, "identity-report.json");
  const output = path.join(tempRoot, "identity-report.enc.json");
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 3072 });
  const script = path.resolve(process.cwd(), "scripts/encrypt-member-account-report.cjs");
  const payload = JSON.stringify({ auth: { uid: "private-uid", email: "private@example.test" } });
  try {
    fs.writeFileSync(input, payload, { mode: 0o600 });
    execFileSync(process.execPath, [script, input, output], { env: { ...process.env, IRPA_MEMBER_AUDIT_REPORT_PUBLIC_KEY: pair.publicKey.export({ type: "spki", format: "pem" }) } });
    assert.equal(fs.existsSync(input), false);
    const envelope = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.equal(envelope.algorithm, "RSA-OAEP-SHA256+A256GCM");
    assert.doesNotMatch(JSON.stringify(envelope), /private-uid|private@example/);
    const key = crypto.privateDecrypt({ key: pair.privateKey, oaepHash: "sha256", padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(envelope.wrappedKey, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    const decoded = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
    assert.equal(decoded, payload);
  } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
});

test("owner report encryption fails closed when public key is missing", () => {
  const { spawnSync } = require("node:child_process");
  const script = path.resolve(process.cwd(), "scripts/encrypt-member-account-report.cjs");
  const result = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8", env: { ...process.env, IRPA_MEMBER_AUDIT_REPORT_PUBLIC_KEY: "" } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /OWNER_REPORT_PUBLIC_KEY_NOT_CONFIGURED/);
});

test("workflow requires repository owner and explicit audit confirmation", () => {
  const workflow = fs.readFileSync(path.resolve(process.cwd(), ".github/workflows/member-account-compatibility-dry-run.yml"), "utf8");
  assert.match(workflow, /github\.actor == 'irpa2412-bit'/);
  assert.match(workflow, /github\.triggering_actor == 'irpa2412-bit'/);
  assert.match(workflow, /I_AUTHORIZE_IRPA_MEMBER_IDENTITY_AUDIT/);
  assert.match(workflow, /vars\.IRPA_MEMBER_AUDIT_REPORT_PUBLIC_KEY/);
  assert.doesNotMatch(workflow, /upload-artifact[\s\S]*?path: reports\/member-account-compatibility-dry-run\.json/);
});
