import test from "node:test";
import assert from "node:assert/strict";
import {
  canConfirmFieldEntry,
  isFieldEntryConfirmationDisabled
} from "../src/fieldEntryDataGatePolicy.js";

const state = (overrides = {}) => ({
  dataType: "governance",
  environment: "ACTUAL",
  actualOnly: false,
  actualDataAccessLoading: false,
  actualDataAccessOpen: false,
  confirmed: true,
  ...overrides
});

function assertBlocked(input) {
  assert.equal(canConfirmFieldEntry(input), false, "entry must not be allowed");
  assert.equal(isFieldEntryConfirmationDisabled(input), true, "confirmation control must remain disabled");
}

function assertAllowed(input) {
  assert.equal(canConfirmFieldEntry(input), true, "entry must be allowed");
  assert.equal(isFieldEntryConfirmationDisabled(input), false, "confirmation control must be enabled");
}

test("ACTUAL + administrator lookup open + user confirms allows entry", () => {
  assertAllowed(state({ actualDataAccessOpen: true, confirmed: true }));
});

test("ACTUAL + administrator lookup open but user has not confirmed remains blocked", () => {
  assertBlocked(state({ actualDataAccessOpen: true, confirmed: false }));
});

test("ACTUAL + administrator lookup pending remains blocked", () => {
  assertBlocked(state({ actualDataAccessLoading: true, actualDataAccessOpen: false }));
});

test("ACTUAL + administrator lookup network error remains blocked", () => {
  // A failed request is represented by a completed lookup with no affirmative open result.
  assertBlocked(state({ actualDataAccessLoading: false, actualDataAccessOpen: false }));
});

test("ACTUAL + administrator lookup returns HTTP 404 remains blocked", () => {
  // A 404 cannot produce an affirmative access-open result.
  assertBlocked(state({ actualDataAccessLoading: false, actualDataAccessOpen: false }));
});

test("ACTUAL + administrator explicitly denies access remains blocked", () => {
  assertBlocked(state({ actualDataAccessLoading: false, actualDataAccessOpen: false }));
});

test("TRIAL remains allowed while administrator lookup is pending", () => {
  assertAllowed(state({
    environment: "TRIAL",
    confirmed: false,
    actualDataAccessLoading: true,
    actualDataAccessOpen: false
  }));
});

test("TRIAL remains allowed when administrator lookup fails or returns HTTP 404", () => {
  for (const failure of ["network-error", "http-404"]) {
    assertAllowed(state({
      environment: "TRIAL",
      confirmed: false,
      actualDataAccessLoading: false,
      actualDataAccessOpen: false,
      lookupFailure: failure
    }));
  }
});
