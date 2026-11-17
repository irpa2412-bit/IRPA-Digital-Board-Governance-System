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

test("Board governance role catalogue retains distinct offices while signer assignment has no authority selector",()=>{
  for(const role of boardRoles){
    assert.ok(catalogue.roles.some(item=>item.title===role),"role catalogue missing: "+role);
    assert.ok(catalogue.signingMatrix.technicalModel.boardRoleOptions.includes(role),"governance matrix missing: "+role);
  }
  assert.doesNotMatch(source,/Current Signing Authority|authorityRegisterRecords|authorityDepartments|authorityRole/);
  assert.doesNotMatch(firebaseSource,/BOARD_SIGNING_ROLES|verifyManualSigningAuthority|findManualAuthorityMatch/);
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

test("governance role matching utilities remain available as reference data but are not imported by signing",()=>{
  assert.doesNotMatch(source,/authorityRegisterRecords|authorityDepartments|findManualAuthorityMatch|resolveManualAuthorityLabel/);
  assert.doesNotMatch(firebaseSource,/getCurrentSigningAuthorityRegisterEntries|findManualAuthorityMatch|verifyManualSigningAuthority/);
  assert.ok(catalogue.roles.some(item=>item.title==="Board Secretary"));
  assert.ok(catalogue.roles.some(item=>item.title==="Executive Director"));
});
test("signer register loader requires an explicit active or activated status", () => {
  const dataSource = fs.readFileSync("src/firebase/data.js", "utf8");
  assert.match(dataSource, /\["active","activated"\]\.includes\(status\)\|\|employmentStatus==="active"\|\|registrationStatus==="activated"/);
  assert.doesNotMatch(dataSource, /record\.status\|\|record\.employmentStatus\|\|"Active"/);
});

test("draft signing matrix documents the technical role source without appointing signatories", () => {
  const model = catalogue.signingMatrix.technicalModel;
  assert.equal(model.status, "PRESERVED_GOVERNANCE_REFERENCE_NOT_USED_IN_SIGNING_PATH");
  assert.match(model.authoritySource, /not used for signer identity, assignment, email verification, signing access, or completion/);
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
  assert.match(finance.limit, /current bank mandate governs/i);
  assert.match(finance.limit, /does not alter the mandate/i);
  const board = matrix.rows.find(row => row.category.startsWith("Board resolutions"));
  assert.match(board.sign, /not assigned by this matrix/i);
  assert.equal(matrix.technicalModel.defaultDecision, "NOT_APPLICABLE_TO_EMAIL_LINK_SIGNING");
  assert.equal(matrix.technicalModel.noAppointmentByTitle, true);
});

test("job descriptions must define reporting, delegation, limits and escalation before runtime authority", () => {
  const standard = catalogue.authorityFramework.jobDescriptionAuthorityStandard;
  for (const field of ["Reports to / supervises", "Permitted initiation, review, verification, recommendation, approval, signature and release actions", "Financial and procurement limits with currency and period, if formally approved", "Escalation triggers and approving authority", "Delegation source, effective date, expiry/review date and revocation status"]) {
    assert.ok(standard.requiredFields.includes(field), `job description standard missing: ${field}`);
  }
  assert.match(standard.default, /DENY/);
});


test("constitutional continuity and Board-member tenure are explicit and distinct",()=>{
 const model=catalogue.authorityFramework.constitutionalOfficeModel;
 assert.equal(model.executiveDirectorBoardSecretary.status,"OCCUPIED_CONFIRMED_BY_OWNER");
 assert.match(model.executiveDirectorBoardSecretary.employment,/IRPA employee/);
 assert.match(model.executiveDirectorBoardSecretary.absenceRepresentation,/next senior Director/);
 assert.equal(model.boardTenure.termYears,4);assert.equal(model.boardTenure.renewalCount,1);assert.equal(model.boardTenure.maximumContinuousTenureYears,8);
 assert.match(model.boardTenure.rule,/does not apply to the employee Board Secretary office/);
});
test("governance and management cycles preserve collective Board authority and ED management accountability",()=>{
 const cycles=catalogue.authorityFramework.governanceManagementCycles;
 assert.ok(cycles.governanceCycle.stages.length>=5);assert.ok(cycles.managementCycle.stages.length>=5);
 assert.match(cycles.governanceCycle.continuity,/permanent employee Board Secretary/);
 assert.match(cycles.managementCycle.accountability,/Executive Director remains accountable to the Board/);
});
test("job-description release chain is ED review and release, Administrator assignment and delegate release",()=>{
 const flow=catalogue.authorityFramework.jobDescriptionReleaseWorkflow;
 assert.equal(flow.status,"APPROVED_DESIGN_MODEL_NOT_YET_RUNTIME_ENFORCED");
 assert.deepEqual(flow.stages.map(s=>s.stage),["EXECUTIVE_DIRECTOR_REVIEW","RELEASE_TO_ADMINISTRATOR","ADMINISTRATIVE_ASSIGNMENT","RELEASE_TO_DELEGATE","ACKNOWLEDGEMENT_AND_ACTIVATION"]);
 assert.match(flow.stages[2].boundary,/may not invent appointments/);
 assert.match(flow.authorization,/server-side authorization/);
});
test("existing bank mandates are recognised without inventing signatories or limits",()=>{
 const bank=catalogue.authorityFramework.constitutionalOfficeModel.banking;
 assert.match(bank.status,/EXISTING_AUTHORISED_BANK_ACCOUNTS/);
 assert.match(bank.rule,/must not create, replace, infer or alter bank signatories/);
 assert.ok(catalogue.signingMatrix.existingBankMandates);
});
test("volunteer roles remain non-authorising and IT support is supervised",()=>{
 const p=catalogue.authorityFramework.interimPersonnelBaseline;
 assert.equal(p.volunteers.length,6);
 assert.match(p.volunteers.find(x=>x.role==="IT Specialist").status,/SUPERVISED_SUPPORT_ONLY/);
 for(const id of ["director-international-oversight","programme-officer","outreach-officer","community-development-officer","director-finance-administration","it-specialist"]){const role=catalogue.roles.find(x=>x.id===id);assert.ok(role);for(const key of ["mayInitiate","mayReview","mayApprove","maySign","mayRelease"])assert.deepEqual(role.workflows[key],[],id+" "+key);}
});
