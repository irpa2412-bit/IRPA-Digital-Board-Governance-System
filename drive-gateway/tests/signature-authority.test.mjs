import test from "node:test";
import assert from "node:assert/strict";
import {
  gatewayAuthorityCandidates,
  normalizeGatewayAuthority,
  resolveGatewayAuthorityLabel
} from "../src/signatureAuthority.mjs";

test("gateway verifies multiple registered roles on one authenticated member or employee record", () => {
  const record = { roles: ["Board Secretary", "Executive Director"] };
  const candidates = gatewayAuthorityCandidates(record);
  assert.ok(candidates.includes("board secretary"));
  assert.ok(candidates.includes("executive director"));
  assert.equal(resolveGatewayAuthorityLabel(record, "Executive Director"), "Executive Director");
});

test("gateway accepts structured roleAssignments without stringifying objects", () => {
  const record = {
    roleAssignments: [
      { role: "Board Treasurer" },
      { title: "Communications Officer" }
    ]
  };
  const candidates = gatewayAuthorityCandidates(record);
  assert.ok(candidates.includes("board treasurer"));
  assert.ok(candidates.includes("communications officer"));
});

test("gateway normalizer handles prefixes and repeated whitespace", () => {
  assert.equal(normalizeGatewayAuthority("  IRPA   Board Secretary  "), "board secretary");
  assert.equal(normalizeGatewayAuthority("The   Executive Director"), "executive director");
});

test("gateway supports the legacy Board Members plural spelling without merging ambiguous director titles", () => {
  assert.equal(normalizeGatewayAuthority("Board Members"), "board member");
  assert.equal(resolveGatewayAuthorityLabel({ role: "Board Member" }, "Board Members"), "Board Member");
  assert.notEqual(normalizeGatewayAuthority("Director Field"), normalizeGatewayAuthority("Field Director"));
  assert.notEqual(normalizeGatewayAuthority("Director Research"), normalizeGatewayAuthority("Research Director"));
});

test("gateway accepts the same scalar authority fields as the client verifier", () => {
  const record = {
    designation: "Board Secretary",
    jobTitle: "Executive Director",
    authorityRole: "Governance Signatory"
  };
  const candidates = gatewayAuthorityCandidates(record);
  assert.ok(candidates.includes("board secretary"));
  assert.ok(candidates.includes("executive director"));
  assert.ok(candidates.includes("governance signatory"));
});
