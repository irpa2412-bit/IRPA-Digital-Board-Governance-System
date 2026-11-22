import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORITY_SOURCES,
  buildAuthorityAssertion,
  isAuthorityActive,
  normalizeSigningIdentity,
} from "../src/signatureTrust/authorityAdapter.mjs";
import {
  SIGNATURE_STATES,
  assertTransition,
  canTransition,
} from "../src/signatureTrust/signatureState.mjs";

const at = new Date("2026-10-07T17:00:00.000Z");

test("controlled trust state machine permits the intended happy path", () => {
  const path = [
    SIGNATURE_STATES.DRAFT,
    SIGNATURE_STATES.PREPARED,
    SIGNATURE_STATES.AUTHORITY_VERIFIED,
    SIGNATURE_STATES.SIGNATURE_REQUESTED,
    SIGNATURE_STATES.DELIVERED,
    SIGNATURE_STATES.VIEWED,
    SIGNATURE_STATES.CONSENTED,
    SIGNATURE_STATES.PARTIALLY_SIGNED,
    SIGNATURE_STATES.FULLY_SIGNED,
  ];

  for (let i = 0; i < path.length - 1; i += 1) {
    assert.equal(canTransition(path[i], path[i + 1]), true);
    assert.doesNotThrow(() => assertTransition(path[i], path[i + 1]));
  }
});

test("controlled trust state machine rejects unsafe skips and reversals", () => {
  assert.equal(canTransition(SIGNATURE_STATES.DRAFT, SIGNATURE_STATES.SIGNED ?? "SIGNED"), false);
  assert.throws(
    () => assertTransition(SIGNATURE_STATES.DRAFT, SIGNATURE_STATES.FULLY_SIGNED),
    /Invalid signature transition/,
  );
  assert.throws(
    () => assertTransition(SIGNATURE_STATES.CONSENTED, SIGNATURE_STATES.AUTHORITY_VERIFIED),
    /Invalid signature transition/,
  );
});

test("terminal states cannot transition", () => {
  for (const terminal of [
    SIGNATURE_STATES.FINAL_ARCHIVE,
    SIGNATURE_STATES.DECLINED,
    SIGNATURE_STATES.VOIDED,
    SIGNATURE_STATES.EXPIRED,
    SIGNATURE_STATES.REVOKED,
    SIGNATURE_STATES.INTEGRITY_FAILED,
    SIGNATURE_STATES.AUTHORITY_FAILED,
    SIGNATURE_STATES.IDENTITY_FAILED,
  ]) {
    assert.throws(
      () => assertTransition(terminal, SIGNATURE_STATES.DRAFT),
      /Terminal signature state cannot transition/,
    );
  }
});

test("completion failure permits controlled retry transitions", () => {
  assert.doesNotThrow(() =>
    assertTransition(SIGNATURE_STATES.COMPLETION_FAILED, SIGNATURE_STATES.FULLY_SIGNED),
  );
  assert.doesNotThrow(() =>
    assertTransition(
      SIGNATURE_STATES.COMPLETION_FAILED,
      SIGNATURE_STATES.CRYPTOGRAPHICALLY_SEALED,
    ),
  );
});

test("identity normalization is deterministic and does not duplicate roles", () => {
  const identity = normalizeSigningIdentity({
    uid: "uid-member-001",
    email: "  MEMBER@IRPA.OR.TZ ",
    name: "  Member One  ",
    profileType: "Member",
    department: "Governance",
    unit: "Board Secretariat",
    roles: ["Signer", "Signer", "  Approver "],
  });

  assert.deepEqual(identity, {
    uid: "uid-member-001",
    email: "member@irpa.or.tz",
    name: "Member One",
    profileType: "Member",
    department: "Governance",
    unit: "Board Secretariat",
    roles: ["Signer", "Approver"],
  });
});

test("authority assertion requires authenticated identity and authoritative reference", () => {
  const identity = normalizeSigningIdentity({
    uid: "uid-employee-001",
    email: "employee@irpa.or.tz",
    profileType: "Employee",
  });

  assert.throws(
    () =>
      buildAuthorityAssertion({
        identity: { ...identity, uid: null },
        authoritySource: AUTHORITY_SOURCES.DEPARTMENT,
        authorityReference: "DEPT-GOV-001",
        effectiveAt: "2026-10-01T00:00:00.000Z",
      }),
    /authenticated institutional identity/,
  );

  assert.throws(
    () =>
      buildAuthorityAssertion({
        identity,
        authoritySource: AUTHORITY_SOURCES.DEPARTMENT,
        authorityReference: "",
        effectiveAt: "2026-10-01T00:00:00.000Z",
      }),
    /authority reference is required/,
  );
});

test("authority assertion accepts only declared authority sources", () => {
  const identity = normalizeSigningIdentity({ uid: "uid-employee-001" });

  assert.throws(
    () =>
      buildAuthorityAssertion({
        identity,
        authoritySource: "UNTRUSTED_SOURCE",
        authorityReference: "REF-001",
        effectiveAt: "2026-10-01T00:00:00.000Z",
      }),
    /authority source is invalid/,
  );
});

test("authority assertion rejects malformed validity windows", () => {
  const identity = normalizeSigningIdentity({ uid: "uid-employee-001" });

  assert.throws(
    () =>
      buildAuthorityAssertion({
        identity,
        authoritySource: AUTHORITY_SOURCES.DEPARTMENT,
        authorityReference: "DEPT-001",
        effectiveAt: "not-a-date",
      }),
    /effective time is invalid/,
  );

  assert.throws(
    () =>
      buildAuthorityAssertion({
        identity,
        authoritySource: AUTHORITY_SOURCES.DEPARTMENT,
        authorityReference: "DEPT-001",
        effectiveAt: "2026-10-07T18:00:00.000Z",
        expiresAt: "2026-10-07T17:00:00.000Z",
      }),
    /validity window is invalid/,
  );
});

test("active authority is evaluated against its effective window", () => {
  const identity = normalizeSigningIdentity({ uid: "uid-employee-001" });
  const assertion = buildAuthorityAssertion({
    identity,
    authoritySource: AUTHORITY_SOURCES.RESOLUTION,
    authorityReference: "RES-2026-010",
    effectiveAt: "2026-10-07T16:00:00.000Z",
    expiresAt: "2026-10-07T18:00:00.000Z",
    scope: ["approve", "sign", "sign"],
  });

  assert.deepEqual(assertion.scope, ["approve", "sign"]);
  assert.equal(isAuthorityActive(assertion, at), true);
  assert.equal(
    isAuthorityActive(assertion, new Date("2026-10-07T18:00:01.000Z")),
    false,
  );
});
