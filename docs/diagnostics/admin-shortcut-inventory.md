# Hard-coded administrator shortcut inventory

Date: 2026-11-03
Branch: `fix/signature-hardening-phase1-20261102`

The hard-coded privileged administrator email shortcut was intentionally NOT removed in Phase 1. This inventory records retrieved source occurrences without reproducing the email value.

## Signature Gateway and closely related server routes

| File | Line(s) | Context |
|---|---:|---|
| `drive-gateway/src/index.js` | 903, 984, 1063, 1082, 1117, 1137, 1165, 1229, 1367, 1591, 1847 | Gateway administrator shortcuts across privileged routes, including signature draft/diagnostic and related operations. Line numbers refer to the Phase 1 branch after the authority/draft edits. |
| `drive-gateway/src/invitationRemoval.mjs` | 10 | Invitation removal administrator shortcut. |
| `drive-gateway/src/releaseReadinessRoutes.mjs` | 26 | Release-readiness administrator shortcut. |
| `drive-gateway/src/meetingPortal.mjs` | 80 | Meeting Portal administrator shortcut. |
| `drive-gateway/src/meetingServices.mjs` | 24, 74 | Meeting service administrator shortcuts. |

## Other repository occurrences found by repository code search

| File | Line(s) |
|---|---:|
| `src/pages/SignaturePlatform.jsx` | 209 |
| `src/components/SignaturePathwaySelfTest.jsx` | 66 |
| `src/firebase/auth.js` | 222 |
| `src/App.jsx` | 657, 837, 933 |
| `functions/index.js` | 152, 196, 229, 546, 672, 724, 727, 736, 748, 864, 1317, 1341, 1380, 1456, 1519, 1529, 1567, 1670, 1720, 1793 |
| `functions/systemControl.js` | 30 |
| `src/pages/Settings.jsx` | 240, 413 |
| `functions/liveMeeting.js` | 158, 265 |
| `src/components/DocumentReader.jsx` | 36 |
| `functions/mfaSecurityAudit.js` | 283 |
| `live-interpreter/src/index.js` | 98 |
| `functions/meetingRecords.js` | 15 |
| `functions/meetingAttendanceRegister.js` | 7 |
| `drive-gateway/wrangler.toml` | 12, 49 |
| `public/administrator.html` | 28, 36, 54, 137 |
| `src/firebase/functions.js` | 77, 96 |
| `GOOGLE_DRIVE_SETUP.md` | 7 |
| `drive-gateway/README.md` | 9 |

The code-search result also returned additional files that could not all be independently line-verified in this pass: `cloudflare/grant-crawler-parallel/wrangler.toml`, `firestore.rules`, `drive-gateway/tests/release-readiness-routes.test.mjs`, and three workflow files. These are NOT RETRIEVED at line-level in this inventory.

## Proposed single server-side administrator policy — for approval only

Replace email-based shortcuts with one shared server-side helper:

1. Resolve the caller from the verified Firebase ID token.
2. Read `adminProfiles/{uid}` using the Worker service-account credential.
3. Grant administrator authority only when the record exists, `active === true`, and `role === "Administrator"`.
4. Fail closed if the record is absent, inactive, malformed, or the Firestore read fails.
5. Apply the same helper consistently to every privileged Gateway route and lifecycle/approval operation.
6. Do not accept client-supplied role flags or email-only identity as administrator proof.
7. Preserve explicit least-privilege rules for non-administrator roles.

This is a proposal only. The existing shortcut remains unchanged pending Daniel's approval and a separately tested migration plan.
