export function meetingEnvironment(value) {
  return value === "TRIAL" ? "TRIAL" : "REAL";
}

export function isTrialMeeting(meeting) {
  return meetingEnvironment(meeting?.environment) === "TRIAL";
}
