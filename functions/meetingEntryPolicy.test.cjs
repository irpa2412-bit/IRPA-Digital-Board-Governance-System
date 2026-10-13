const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeMeetingEntryMode, resolveMeetingEntryState } = require("./meetingEntryPolicy");

test("host approval is the secure default for missing or unrecognised policy", () => {
  assert.equal(normalizeMeetingEntryMode({}), "HOST_APPROVAL");
  assert.equal(normalizeMeetingEntryMode({meetingEntryMode:"unexpected"}), "HOST_APPROVAL");
});
test("direct entry is enabled only by an explicit DIRECT policy", () => {
  assert.equal(normalizeMeetingEntryMode({meetingEntryMode:"DIRECT"}), "DIRECT");
  assert.equal(normalizeMeetingEntryMode({meetingEntryMode:"direct"}), "DIRECT");
  assert.equal(normalizeMeetingEntryMode({meetingEntryMode:"HOST_APPROVAL"}), "HOST_APPROVAL");
});
test("host approval waits until the host admits the request", () => {
  assert.equal(resolveMeetingEntryState("HOST_APPROVAL", "PENDING"), "WAITING_FOR_HOST");
  assert.equal(resolveMeetingEntryState("HOST_APPROVAL", "ADMITTED"), "AUTHORIZED");
  assert.equal(resolveMeetingEntryState("HOST_APPROVAL", "DENIED"), "DENIED");
});
test("explicit direct entry bypasses waiting-room state only after upstream identity checks", () => {
  assert.equal(resolveMeetingEntryState("DIRECT", null), "AUTHORIZED");
});
