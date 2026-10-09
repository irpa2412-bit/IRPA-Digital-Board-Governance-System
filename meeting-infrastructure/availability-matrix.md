# IRPA-DBGS live meeting availability matrix

Evidence status as of 2026-10-09. “Not verified” means no live service evidence was available; it does not assert that an external service is down.

| Requirement | Repository evidence | Status | Acceptance evidence needed |
|---|---|---|---|
| HTTPS web app | Firebase Hosting configuration exists; public URL could not be independently verified from the available inspection channel | Not verified | HTTPS 200/valid certificate for the actual staging URL |
| Firebase meeting Functions | Source exists: `issueLiveMeetingToken`, `authorizeMeetingEntry`, `createMeetingAccessInvitation`, `revokeMeetingAccessInvitation` | Code present; deployed state not verified | `firebase functions:list` on dedicated staging project and a successful authenticated callable test |
| LiveKit endpoint | No configured/reachable endpoint established; infrastructure docs say production installation is pending | Missing/unverified | DNS/TLS check plus authenticated `RoomServiceClient.listRooms()` using staging-only credentials |
| Firebase Secret Manager binding | Token function now binds API key/secret explicitly with `defineSecret` | Code correction included in readiness branch; deployment still required | Deploy function and confirm secret access without logging secret values |
| Invitation dispatch | Invitation access-pass and mail integration code exists; mail invitation CI passed on integration | Code-tested; real delivery unverified | Actual invitation received by the invited mailbox; gate password delivered separately and accepted |
| Host/invitee identities | No actual live test identities were available to inspect | Not verified | Two distinct authenticated accounts/browser profiles; invitee identity matches participant record |
| Devices/network | Browser permission UI and 720p capture target exist | Not verified | Both cameras/mics, two-way media, mobile and restrictive-network test |
| Real HD audio/video | No browser-to-browser call has been run | Not verified | Two-way audio/video; report negotiated resolution/frame rate, packet loss, RTT and reconnect behavior |

## Go/no-go
Do not call the meeting live-media-ready until the LiveKit API preflight and two-browser acceptance test pass. CI passing is necessary but not sufficient.
