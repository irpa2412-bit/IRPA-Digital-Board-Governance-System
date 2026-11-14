import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/pages/SignaturePlatform.jsx", "utf8");
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
  const match = source.match(/const BOARD_SIGNING_ROLES=\[([^\]]+)\]/);
  assert.ok(match, "Board signing eligibility list must remain explicit");
  const configured = [...match[1].matchAll(/"([^"]+)"/g)].map(item => item[1]);
  for (const role of boardRoles) assert.ok(configured.includes(role), `signer eligibility missing: ${role}`);
});

test("Board Member display remains singular while accepting the legacy plural spelling", () => {
  assert.match(source, /normalized==="board member"\|\|normalized==="board members"\) return "Board Member"/);
  assert.match(source, /r==="board member"\|\|r==="board members"/);
});
