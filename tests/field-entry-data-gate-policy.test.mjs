import test from "node:test";
import assert from "node:assert/strict";
import { canConfirmFieldEntry, isFieldEntryConfirmationDisabled } from "../src/fieldEntryDataGatePolicy.js";

const base = { dataType: "governance", environment: "ACTUAL", actualOnly: false, confirmed: true };

test("ACTUAL remains blocked while administrator access lookup is pending", () => {
  const state = { ...base, actualDataAccessLoading: true, actualDataAccessOpen: false };
  assert.equal(canConfirmFieldEntry(state), false);
  assert.equal(isFieldEntryConfirmationDisabled(state), true);
});

test("ACTUAL remains blocked when administrator access lookup fails", () => {
  const state = { ...base, actualDataAccessLoading: false, actualDataAccessOpen: false };
  assert.equal(canConfirmFieldEntry(state), false);
  assert.equal(isFieldEntryConfirmationDisabled(state), true);
});

test("ACTUAL remains blocked when administrator denies access, including actual-only records", () => {
  for (const actualOnly of [false, true]) {
    const state = { ...base, actualOnly, actualDataAccessLoading: false, actualDataAccessOpen: false };
    assert.equal(canConfirmFieldEntry(state), false);
    assert.equal(isFieldEntryConfirmationDisabled(state), true);
  }
});

test("ACTUAL is available only after lookup allows access and the user confirms", () => {
  const state = { ...base, actualDataAccessLoading: false, actualDataAccessOpen: true };
  assert.equal(canConfirmFieldEntry(state), true);
  assert.equal(isFieldEntryConfirmationDisabled(state), false);
});

test("TRIAL works while lookup is pending, failed, or denied", () => {
  for (const lookup of [
    { actualDataAccessLoading: true, actualDataAccessOpen: false },
    { actualDataAccessLoading: false, actualDataAccessOpen: false }
  ]) {
    const state = { ...base, environment: "TRIAL", confirmed: false, ...lookup };
    assert.equal(canConfirmFieldEntry(state), true);
    assert.equal(isFieldEntryConfirmationDisabled(state), false);
  }
});
