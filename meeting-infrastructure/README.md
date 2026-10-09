# IRPA-DGBS Live Meeting Infrastructure

## Current verified state
The repository contains the LiveKit browser client and Firebase Functions for meeting entry and token issuance. That is application code, not a running media service. No deployment is considered ready until the preflight below succeeds against a dedicated staging environment and two real participants complete a browser-to-browser call.

## Required staging components
1. A deployed HTTPS web build on a dedicated staging URL.
2. A dedicated Firebase staging project with `authorizeMeetingEntry`, `createMeetingAccessInvitation`, `revokeMeetingAccessInvitation`, and `issueLiveMeetingToken` deployed.
3. Firebase Secret Manager secrets named `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`, bound to `issueLiveMeetingToken`; a non-secret `LIVEKIT_URL` runtime setting pointing to the reachable LiveKit WebSocket endpoint.
4. A reachable LiveKit service with TLS, valid API credentials, public DNS, and WebRTC UDP/TCP/TURN reachability.
5. A real meeting host and a separate invited participant, each using their own authenticated browser profile.
6. Working cameras/microphones, HTTPS permissions, and separate network paths for the first test.

## Self-hosted topology
The recommended IRPA-owned topology uses LiveKit OSS on a dedicated public VM, with Caddy/TLS, Redis where required by the chosen configuration, UDP media, TCP fallback, and TURN/TLS. Use LiveKit's official VM generator to produce a configuration matched to the selected domain and current server release:
https://docs.livekit.io/transport/self-hosting/vm/

Required DNS names in the planned topology are `meet.irpa.or.tz` and `turn.meet.irpa.or.tz`. They are plans, not confirmed existing DNS records. Do not deploy until IRPA controls these names and they resolve to the chosen VM.

Typical firewall requirements for the official VM topology:
- TCP 80 and 443 for certificate issuance and HTTPS/TURN-TLS
- TCP 7881 for WebRTC fallback
- UDP 3478 for TURN/UDP, if enabled
- UDP 50000-60000 for WebRTC media, unless the chosen config uses another documented range

Confirm exact ports against the generated config and official documentation before opening the firewall. Never expose the LiveKit API secret in the browser, web build, repository, or logs.

## Configure Firebase secrets
From an authorized operator environment, using the staging Firebase project only:

```sh
firebase use <STAGING_FIREBASE_PROJECT_ID>
firebase functions:secrets:set LIVEKIT_API_KEY
firebase functions:secrets:set LIVEKIT_API_SECRET
```

Enter values at the interactive prompts; do not place secrets in command-line arguments. Configure `LIVEKIT_URL` in the staging Functions runtime environment as the WebSocket endpoint, e.g. `wss://meet.<your-controlled-domain>`. Then deploy the Functions to staging through the approved staging workflow. The current repository production deployment workflow targets `main`; merging into the integration branch alone does not deploy Functions.

## Preflight commands
Install the Functions dependencies, then run the authenticated LiveKit API connectivity check in the same secure environment where the three runtime values are available:

```sh
cd functions
npm install
LIVEKIT_URL='wss://meet.<your-controlled-domain>' npm run check:livekit-connectivity
```

The checker reads `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from environment variables but never prints them. It makes an authenticated LiveKit RoomService request, proving endpoint reachability and API credential acceptance. This check does not prove browser media routing.

Before a live rehearsal, also verify the staging site is HTTPS, all four Functions exist in the staging project, and invitation delivery reaches the real test invitee.

## Interactive acceptance test
1. Host: sign in in browser profile A; open the meeting; issue the invitation from Participants.
2. Invitee: open the delivered email in browser profile B; use the supplied gate password separately from the URL; sign in with the invited identity; enter the matching meeting.
3. Both: grant camera/microphone permissions and run device check.
4. Host and invitee: join the room; verify each sees the other, speaks and hears the other, toggles mic/camera, and recovers after one participant briefly switches networks or reconnects.
5. Confirm the browser console and Functions logs contain no token, authorization, TLS, ICE, or TURN failures. Never paste tokens or passwords into the test report.
6. Repeat with Android/mobile and with a restrictive network to confirm TCP/TURN fallback.

## Acceptance criteria
- Invitation email arrives and the link plus separately supplied gate password authorize the intended participant only.
- `issueLiveMeetingToken` returns a short-lived token only for the authorized meeting and identity.
- LiveKit authenticated connectivity preflight succeeds.
- Both participants publish and subscribe to audio/video; two-way audio is clear and video is stable.
- Record negotiated resolution/frame rate and observed network behavior; 720p/30 is a capture target, not a guarantee.
- Mobile layout is usable; mic/camera controls and leave action work.
- Revoked/expired access fails closed.
- No Firebase production records, authorization rules, or administrator claims are altered by the staging rehearsal.

## What this repository cannot provision by itself
A public VM, DNS records, firewall rules, TLS issuance, Firebase project access, secret values, real participant identities, and device/network permission are external operational prerequisites. They must be supplied by an authorized IRPA operator. Do not claim a live test passed based on CI or a local-only media server.
