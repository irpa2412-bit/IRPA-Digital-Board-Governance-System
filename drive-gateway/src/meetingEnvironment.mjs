export function meetingEnvironment(value) {
  return String(value ?? "").trim().toUpperCase() === "TRIAL" ? "TRIAL" : "REAL";
}

export function isTrialMeeting(meeting) {
  return meetingEnvironment(meeting?.environment) === "TRIAL";
}
