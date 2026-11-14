import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("src/App.jsx", "utf8");
const catalogue = JSON.parse(fs.readFileSync("config/org-structure-authority.json", "utf8"));
const departmentStart = app.indexOf("const DEPARTMENTAL_MODULES={");
const roleStart = app.indexOf("const ROLE_DEPARTMENT={", departmentStart);
const departmentEnd = app.lastIndexOf("};", roleStart);
const roleEnd = app.indexOf("};", roleStart);
assert.ok(departmentStart >= 0 && departmentEnd > departmentStart, "DEPARTMENTAL_MODULES must be present");
assert.ok(roleStart > departmentEnd && roleEnd > roleStart, "ROLE_DEPARTMENT must be present");
const departmentBlock = app.slice(departmentStart, departmentEnd + 2);
const roleBlock = app.slice(roleStart, roleEnd + 2);

test("every approved directorate has an explicit portal-routing entry", () => {
  for (const directorate of catalogue.directorates) {
    assert.ok(departmentBlock.includes(`"${directorate.name}":[`), directorate.name);
  }
});

test("every department and unit-bearing substructure has a routing entry", () => {
  for (const directorate of catalogue.directorates) {
    for (const department of directorate.departments) {
      assert.ok(departmentBlock.includes(`"${department.name}":[`),
        `${directorate.name} / ${department.name}`);
    }
  }
});

test("each non-ambiguous organisational role routes within its catalogue directorate", () => {
  const ambiguous = new Set(catalogue.compatibilityAliasCandidates
    .filter(item => item.status === "AMBIGUOUS_OWNER_DECISION_REQUIRED")
    .map(item => item.alias));
  for (const role of catalogue.roles) {
    if (role.title === "Management" || role.title === "Employee" || role.title === "interim sole-approver") continue;
    const marker = `"${role.title}":"`;
    const index = roleBlock.indexOf(marker);
    if (ambiguous.has(role.title)) {
      assert.equal(index, -1, `${role.title} must remain unmapped pending owner decision`);
      continue;
    }
    const directorate = catalogue.directorates.find(item => item.name === role.directorate);
    const centralOffice = catalogue.centralOffice?.name === role.directorate ? catalogue.centralOffice : null;
    assert.ok(directorate || centralOffice, `missing directorate or central office for ${role.title}`);
    const unit = directorate || centralOffice;
    const allowed = new Set([unit.name, ...unit.departments.map(item => item.name)]);
    assert.ok(index >= 0, `${role.title} must have a portal-routing entry`);
    const remainder = roleBlock.slice(index + marker.length);
    const routed = remainder.slice(0, remainder.indexOf('"'));
    assert.ok(allowed.has(routed), `${role.title} routes to ${routed}, outside ${role.directorate}`);
  }
});
test("legacy department labels remain supported during transition", () => {
  for (const legacy of [
    "Finance & Administration",
    "Livestock",
    "Environment & Rangeland",
    "Outreach & Community Development",
    "Research, Statistics and Knowledge Department"
  ]) {
    assert.ok(departmentBlock.includes(`"${legacy}":[`), legacy);
  }
});

test("directorate routing does not expose administrator-only configuration tools", () => {
  assert.ok(!departmentBlock.includes('"Add Administrator"'));
  assert.ok(!departmentBlock.includes('"Department Portal Builder"'));
  assert.ok(!departmentBlock.includes('"Settings"'));
});

test("Market Development remains mapped only to existing operational modules", () => {
  assert.match(departmentBlock, /"Market Development":\["Reports","Actions"\]/);
  assert.ok(!departmentBlock.includes('"Market Development Portal"'));
});

test("Executive Office is central and is not counted as a fourteenth directorate", () => {
  assert.equal(catalogue.directorates.length, 13);
  assert.equal(catalogue.centralOffice?.name, "Executive Office");
  assert.equal(catalogue.centralOffice?.status, "CENTRAL_OFFICE_NOT_COUNTED_AS_A_DIRECTORATE");
  assert.ok(!catalogue.directorates.some(item => item.name === "Executive Office"));
});

test("portal routing has exactly one authoritative role-to-directorate map", () => {
  assert.equal((app.match(/const ROLE_DEPARTMENT=/g) || []).length, 1);
});

test("ambiguous role titles are absent from role-gated portal and workflow arrays", () => {
  const ambiguous = catalogue.compatibilityAliasCandidates
    .filter(item => item.status === "AMBIGUOUS_OWNER_DECISION_REQUIRED")
    .map(item => item.alias);
  for (const name of ["PROCUREMENT_APPROVAL_ROLES", "RESEARCH_AUTHORITY_ROLES", "COMMUNICATIONS_ROLES"]) {
    const start = app.indexOf(`const ${name}=`);
    assert.ok(start >= 0, `${name} must remain explicit`);
    const end = app.indexOf("];", start);
    assert.ok(end > start, `${name} must be a bounded role list`);
    const block = app.slice(start, end);
    for (const alias of ambiguous) assert.ok(!block.includes(`"${alias}"`), `${alias} must not grant ${name}`);
  }
});
