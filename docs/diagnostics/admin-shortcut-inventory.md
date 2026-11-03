# Hard-coded administrator shortcut inventory

Date: 2026-11-03
Branch: `fix/signature-hardening-phase1-20261102`

The hard-coded privileged administrator email shortcut was intentionally NOT removed in Phase 1. This inventory records retrieved source occurrences without reproducing the email value.

## Signature Gateway and closely related server routes

| File | Line(s) | Context |
|---|---:|---|
| `drive-gateway/src/index.js` | 880, 961, 1040, 1059, 1094, 1114, 1142, 1197, 1335, 1559, 1815 | Gateway administrator shortcuts across privileged routes, including signature draft/diagnostic and related operations. Line numbers refer to the Phase 1 branch after the authority/draft edits. |
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
| `cloudflare/grant-crawler-parallel/wrangler.toml` | 30, 52 |
| `firestore.rules` | 28 |
| `drive-gateway/tests/release-readiness-routes.test.mjs` | 8 |
| `.github/workflows/firebase-deploy.yml` | 96, 108, 109, 190 |
| `.github/workflows/provision-meeting-archives.yml` | 52 |
| `.github/workflows/staging-gateway-e2e.yml` | 281, 1941 |

Additional line-level occurrences verified after the initial inventory:

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
