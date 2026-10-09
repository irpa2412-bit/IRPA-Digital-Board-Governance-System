const crypto = require("crypto");

/**
 * Derive one opaque, stable LiveKit room per IRPA meeting.
 *
 * The room must not include a per-participant session ID: every authorized
 * participant in the same meeting must receive a token for the same room.
 */
function opaqueRoomName(meetingId) {
  const id = String(meetingId ?? "").trim();
  if (!id) throw new TypeError("Meeting ID is required to derive a media room.");
  const digest = crypto.createHash("sha256").update(id).digest("hex").slice(0, 32);
  return `irpa-meeting-${digest}`;
}

module.exports = { opaqueRoomName };
