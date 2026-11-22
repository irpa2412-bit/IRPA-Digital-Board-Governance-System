import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const authority = JSON.parse(readFileSync(new URL("../config/org-structure-authority.json", import.meta.url), "utf8"));
const roles = new Map(authority.roles.map(role => [role.id, role]));
const policy = authority.operationalAccessPolicy;

test("volunteers receive duty-complete operational access as policy, not blanket admin access", () => {
  assert.match(policy.status, /NOT A RUNTIME GRANT/);
  assert.match(policy.principle, /Volunteer status alone is not a reason to withhold operational access/);
  assert.match(policy.accessMeaning, /not unrestricted system-owner/);
  assert.ok(policy.reservedCapabilities.includes("Primary administrator and account/security administration"));
  assert.match(policy.default, /DENY/);
});

test("all four owner-confirmed positions are recorded occupied", () => {
  for (const id of ["director-internal-oversight", "programme-officer", "it-specialist", "community-development-officer"]) {
    assert.match(roles.get(id).positionsRequired, /OCCUPIED/);
    assert.match(roles.get(id).operationalAccessModel, /FULL_OPERATIONAL_ACCESS_FOR_VERIFIED_ASSIGNED_DUTIES/);
    assert.match(roles.get(id).accessStatus, /DENY/);
  }
});

test("Director Internal Oversight engagement category is not inferred", () => {
  const role = roles.get("director-internal-oversight");
  assert.match(role.engagementStatus, /NOT VERIFIED/);
  assert.match(role.appointmentStatus, /ENGAGEMENT CATEGORY NOT VERIFIED/);
});

test("volunteer classifications and availability context are retained", () => {
  assert.match(roles.get("programme-officer").engagementStatus, /VOLUNTEER.*LIMITED AVAILABILITY/);
  assert.match(roles.get("it-specialist").engagementStatus, /VOLUNTEER.*PRELIMINARY COLLEGE TRAINING/);
  assert.match(roles.get("community-development-officer").engagementStatus, /VOLUNTEER.*LIMITED AVAILABILITY/);
  assert.match(roles.get("it-specialist").engagementStatus, /OFFICIAL DUTIES UNDER EXECUTIVE DIRECTOR SUPERVISION/);
});

test("Director of International Oversight remains a distinct role", () => {
  assert.equal(roles.has("director-international-oversight"), true);
  assert.equal(roles.get("director-international-oversight").positionsRequired, "1 — VACANT");
});

test("policy prerequisites require identity, assignment, scope and server enforcement", () => {
  for (const phrase of ["Verified institutional identity", "Current appointment or formal volunteer assignment", "Approved job description", "Server-side authorization"]) {
    assert.ok(policy.grantPrerequisites.some(item => item.includes(phrase)), phrase);
  }
});
