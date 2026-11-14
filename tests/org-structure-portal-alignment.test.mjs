import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("src/App.jsx", "utf8");
const catalogue = JSON.parse(fs.readFileSync("config/org-structure-authority.json", "utf8"));
const departmentStart = app.indexOf("const DEPARTMENTAL_MODULES={");
const departmentEnd = app.indexOf("};\nconst ROLE_DEPARTMENT=", departmentStart);
const roleStart = app.indexOf("const ROLE_DEPARTMENT={", departmentEnd);
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

test("each named organisational role routes to its catalogue directorate", () => {
  for (const role of catalogue.roles) {
    if (role.title === "Management" || role.title === "Employee" || role.title === "interim sole-approver") continue;
    assert.ok(roleBlock.includes(`"${role.title}":"${role.directorate}"`),
      `${role.title} must route to ${role.directorate}`);
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
