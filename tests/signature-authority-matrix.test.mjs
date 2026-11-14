import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { authorityCandidates, findManualAuthorityMatch, normalizeManualAuthority, resolveManualAuthorityLabel } from "../src/utils/signatureAuthority.mjs";
import { gatewayAuthorityCandidates, resolveGatewayAuthorityLabel } from "../drive-gateway/src/signatureAuthority.mjs";

const source = fs.readFileSync("src/pages/SignaturePlatform.jsx", "utf8");
const firebaseSource = fs.readFileSync("src/firebase/signaturePlatform.js", "utf8");
const catalogue = JSON.parse(fs.readFileSync("config/org-structure-authority.json", "utf8"));
const boardRoles = [
  "Board Chairperson",
  "Board Vice Chairperson",
  "Board Secretary",
  "Board Treasurer",
  "Board Member"
];

test("signature authority selector includes every distinct Board signing office", () => {
  const selector = source.match(/if\(department==="board of directors"\)\{([\s\S]*?)\n   \}/);
  assert.ok(selector, "Board of Directors selector must remain explicit");
  for (const role of boardRoles) {
    assert.ok(selector[1].includes(`role:"${role}"`), `missing Board signer role: ${role}`);
    assert.ok(catalogue.roles.some(item => item.title === role), `role catalogue missing: ${role}`);
  }
});

test("Board signer eligibility list matches the role catalogue without collapsing Treasurer or Member", () => {
  const match = firebaseSource.match(/const BOARD_SIGNING_ROLES=\[([^\]]+)\]/);
  assert.ok(match, "Board signing eligibility list must remain explicit");
  const configured = [...match[1].matchAll(/"([^"]+)"/g)].map(item => item[1]);
  for (const role of boardRoles) assert.ok(configured.includes(role), `signer eligibility missing: ${role}`);
});

test("Board Member display remains singular while accepting the legacy plural spelling", () => {
  assert.match(source, /normalized==="board member"\|\|normalized==="board members"\) return "Board Member"/);
  assert.match(source, /r==="board member"\|\|r==="board members"/);
});

test("signer authority verification recognises multiple roles stored on one member or employee record", () => {
  const dualRoleRecord = {
    uid: "dual-role-test",
    department: "Governance",
    roles: ["Board Secretary", "Executive Director"],
    sourceCollection: "members"
  };
  assert.ok(authorityCandidates(dualRoleRecord).includes("board secretary"));
  assert.ok(authorityCandidates(dualRoleRecord).includes("executive director"));
  assert.equal(findManualAuthorityMatch([dualRoleRecord], "Board Secretary"), dualRoleRecord);
  assert.equal(findManualAuthorityMatch([dualRoleRecord], "Executive Director"), dualRoleRecord);
  assert.equal(resolveManualAuthorityLabel(dualRoleRecord, "Executive Director"), "Executive Director");
});

test("client authority normalizer handles prefixes and repeated whitespace", () => {
  assert.equal(normalizeManualAuthority("  IRPA   Board Secretary  "), "board secretary");
  assert.equal(normalizeManualAuthority("The   Executive Director"), "executive director");
});

test("legacy Board Members plural input resolves to the distinct Board Member role", () => {
  const record = { role: "Board Member" };
  assert.equal(normalizeManualAuthority("Board Members"), "board member");
  assert.equal(findManualAuthorityMatch([record], "Board Members"), record);
  assert.equal(resolveManualAuthorityLabel(record, "Board Members"), "Board Member");
});

test("department and unit labels cannot be used as signing authority", () => {
  const unitOnly = { unit: "Finance Unit", unitName: "Procurement Unit" };
  assert.deepEqual(authorityCandidates(unitOnly), []);
  assert.equal(findManualAuthorityMatch([unitOnly], "Finance Unit"), null);
});

test("ambiguous director titles remain distinct and are not silently aliased", () => {
  assert.notEqual(normalizeManualAuthority("Director Field"), normalizeManualAuthority("Field Director"));
  assert.notEqual(normalizeManualAuthority("Director Research"), normalizeManualAuthority("Research Director"));
  assert.equal(findManualAuthorityMatch([{ role: "Field Director" }], "Director Field"), null);
  assert.equal(findManualAuthorityMatch([{ role: "Research Director" }], "Director Research"), null);
});

test("signer authority selector and verifier accept the same scalar and multi-role register fields", () => {
  assert.match(source, /record\.designation,record\.jobTitle,record\.position,record\.title,record\.authorityRole/);
  assert.match(source, /value&&typeof value==="object"/);
  assert.match(source, /record\.roles/);
  assert.match(source, /record\.assignedRoles/);
  assert.match(source, /record\.selectedRoles/);
  assert.match(source, /record\.roleAssignments/);
});

test("signer register loader requires an explicit active or activated status", () => {
  const dataSource = fs.readFileSync("src/firebase/data.js", "utf8");
  assert.match(dataSource, /\["active","activated"\]\.includes\(status\)\|\|employmentStatus==="active"\|\|registrationStatus==="activated"/);
  assert.doesNotMatch(dataSource, /record\.status\|\|record\.employmentStatus\|\|"Active"/);
});

test("draft signing matrix documents the technical role source without appointing signatories", () => {
  const model = catalogue.signingMatrix.technicalModel;
  assert.equal(model.status, "IMPLEMENTED_IN_DRAFT_CODE_NOT_A_LEGAL_SIGNATORY_APPOINTMENT");
  assert.equal(model.authoritySource, "Current authenticated Member and Employee register entries for the signer");
  assert.equal(model.multipleRegisteredRolesPerPerson, true);
  assert.deepEqual(model.boardRoleOptions, boardRoles);
  assert.match(model.ambiguousTitles, /Exact-match only/);
  assert.match(model.administratorRecognition, /job title Administrator alone cannot/);
  assert.match(model.limitation, /do not appoint signatories/);
});

test("browser and Cloudflare Gateway resolve the same dual-role register values", () => {
  const record = {
    role: "Executive Director",
    roles: ["Board Secretary", "Executive Director"],
    roleAssignments: [{ role: "Board Treasurer" }]
  };
  assert.deepEqual(authorityCandidates(record), gatewayAuthorityCandidates(record));
  assert.equal(resolveManualAuthorityLabel(record, "Board Secretary"), resolveGatewayAuthorityLabel(record, "Board Secretary"));
  assert.equal(resolveManualAuthorityLabel(record, "Board Treasurer"), resolveGatewayAuthorityLabel(record, "Board Treasurer"));
});


test("governance authority is distinct from Executive Director management authority", () => {
  const framework = catalogue.authorityFramework;
  assert.equal(framework.governance.authority, "Board of Directors acting collectively under the Constitution, approved policies and recorded resolutions.");
  assert.equal(framework.management.authority, "Executive Director is the overall management authority and reports to the Board of Directors.");
  assert.ok(framework.governance.reservedMatters.length >= 4);
  assert.match(framework.management.limits, /Board-reserved matters/);
});

test("management directorates report through the Executive Director, with explicit governance exceptions", () => {
  for (const directorate of catalogue.directorates) {
    if (directorate.name === "Governance") {
      assert.deepEqual(directorate.reportsTo, ["Board"]);
    } else {
      assert.deepEqual(directorate.reportsTo, ["Executive Director"]);
    }
    assert.ok(directorate.authorityRelationship, `missing authority relationship for ${directorate.name}`);
    for (const department of directorate.departments) {
      assert.ok(department.delegationModel, `missing delegation model for ${department.name}`);
      assert.match(department.delegationModel.delegationStatus, /NOT_ASSIGNED/);
    }
  }
  assert.deepEqual(catalogue.centralOffice.reportsTo, ["Executive Director"]);
  const audit = catalogue.directorates.find(item => item.name === "Internal Oversight");
  assert.equal(audit.authorityRelationship.functionalOversightBy, "Board");
});

test("signature matrix separates workflow stages and preserves unassigned legal and financial authorities", () => {
  const matrix = catalogue.signingMatrix;
  assert.match(matrix.status, /DRAFT_FOR_BOARD_REVIEW/);
  assert.ok(matrix.rows.length >= 8);
  for (const row of matrix.rows) {
    for (const key of ["prepare", "review", "recommend", "approve", "sign", "release", "evidence", "limit"]) {
      assert.ok(typeof row[key] === "string" && row[key].length > 0, `${row.category} missing ${key}`);
    }
  }
  const finance = matrix.rows.find(row => row.category.startsWith("Finance,"));
  assert.match(finance.limit, /no monetary thresholds or bank signatories/i);
  const board = matrix.rows.find(row => row.category.startsWith("Board resolutions"));
  assert.match(board.sign, /not assigned by this matrix/i);
  assert.equal(matrix.technicalModel.defaultDecision, "DENY");
  assert.equal(matrix.technicalModel.noAppointmentByTitle, true);
});

test("job descriptions must define reporting, delegation, limits and escalation before runtime authority", () => {
  const standard = catalogue.authorityFramework.jobDescriptionAuthorityStandard;
  for (const field of ["Reports to / supervises", "Permitted initiation, review, verification, recommendation, approval, signature and release actions", "Financial and procurement limits with currency and period, if formally approved", "Escalation triggers and approving authority", "Delegation source, effective date, expiry/review date and revocation status"]) {
    assert.ok(standard.requiredFields.includes(field), `job description standard missing: ${field}`);
  }
  assert.match(standard.default, /DENY/);
});
