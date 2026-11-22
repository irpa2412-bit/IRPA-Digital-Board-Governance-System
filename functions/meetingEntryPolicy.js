function normalizeMeetingEntryMode(meeting={}) {
  return String(meeting.meetingEntryMode || "HOST_APPROVAL").trim().toUpperCase() === "DIRECT"
    ? "DIRECT"
    : "HOST_APPROVAL";
}

function resolveMeetingEntryState(mode, requestStatus) {
  if (normalizeMeetingEntryMode({meetingEntryMode:mode}) === "DIRECT" || requestStatus === "ADMITTED") return "AUTHORIZED";
  if (requestStatus === "DENIED") return "DENIED";
  return "WAITING_FOR_HOST";
}

module.exports = { normalizeMeetingEntryMode, resolveMeetingEntryState };
