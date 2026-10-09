const test = require("node:test");
const assert = require("node:assert/strict");
const { opaqueRoomName } = require("./liveMeetingPolicy");

test("same meeting always resolves to the same opaque media room", () => {
  const firstParticipantRoom = opaqueRoomName("meeting-2026-001");
  const secondParticipantRoom = opaqueRoomName("meeting-2026-001");
  assert.equal(firstParticipantRoom, secondParticipantRoom);
  assert.match(firstParticipantRoom, /^irpa-meeting-[a-f0-9]{32}$/);
});

test("different meetings resolve to different media rooms", () => {
  assert.notEqual(
    opaqueRoomName("meeting-2026-001"),
    opaqueRoomName("meeting-2026-002")
  );
});

test("media room name does not expose the meeting identifier", () => {
  const room = opaqueRoomName("board-meeting-confidential-2026");
  assert.equal(room.includes("confidential"), false);
  assert.equal(room.includes("board-meeting"), false);
});

test("missing meeting ID is rejected", () => {
  assert.throws(() => opaqueRoomName("  "), /Meeting ID is required/);
});
