# Meeting Attendance Callable Boundary — Change Record

- Change ID: MP-2026-11-22-ATT-CALLABLE-GUARD
- Scope: read-only source audit and regression guard for attendance UI callable dependencies.
- Baseline: 1a02a5114963fdeec03111d82544f0c5ddb11ff7 (main).
- Finding: the current Meeting Room attendance screen invokes Worker-backed client methods for daily register retrieval, attendance marking and daily signature dispatch. Routes are /api/meeting-attendance/daily/register, /api/meeting-attendance/daily/mark and /api/meeting-attendance/daily/dispatch; self/host marking uses /api/meeting-attendance/mark. These methods are in src/firebase/meetingRecords.js and use callMeetingService, not Firebase callable functions.
- Legacy callable definitions: functions/meetingAttendanceRegister.js still defines signMeetingAttendance and getMeetingAttendanceRegister using onCall. Repository inventory identifies them as legacy definitions not called by the migrated frontend. No attendance screen action was found invoking either callable.
- Change: extend scripts/check-meeting-media-governance.mjs to scan attendance-related screens and the shared attendance client for direct httpsCallable() or getFunctions() calls. Existing Worker-route assertions remain in place.
- Authority and identity: no Worker route, authority check, guest handling, duplicate-signer handling, signer identity, or email/UID deduplication logic is changed.
- Prohibited changes: no envelope, signing rules, tokens, link format, sessions, signer identity, field assignment, stamping, PDF, hash, certificate, archive logic, Firestore rules, secrets, environment variables, SMTP settings, or branch protection changes.
- Deployment: not applicable to this source-only regression guard. No Firebase Functions deployment is attempted.
- Validation: required CI checks on the pull request must pass before merge. The test fails if an attendance screen directly calls an undeployed Firebase callable.
