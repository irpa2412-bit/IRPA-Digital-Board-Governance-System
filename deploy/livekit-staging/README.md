# IRPA-DBGS LiveKit staging deployment pack

This directory is the operator hand-off for provisioning a **separate staging media plane**. It does not deploy anything by itself and must not be pointed at production credentials.

## Important distinction

YouTube is a one-to-many broadcast platform. IRPA's meeting requirement is low-latency, bidirectional WebRTC conferencing. The intended architecture is the existing Firebase-authenticated IRPA meeting gateway issuing short-lived, room-scoped tokens to a LiveKit SFU. The SFU handles realtime media; Firebase/Firestore remain authoritative for meeting identity, invitations, roles and governance records.

## Prerequisites that cannot be created by a repository commit

1. An approved cloud account and a dedicated public VM with sufficient CPU, RAM and network bandwidth.
2. A domain controlled by IRPA and DNS access for two names, e.g. `livekit-staging.example.org` and `turn-staging.example.org`.
3. Public firewall access for TCP 80/443, TCP 7881, UDP 3478 and UDP 50000–60000. Confirm cloud-provider firewall rules as well as the host firewall.
4. A separate Firebase staging project (or explicitly approved staging environment), with the Functions deployment identity authorized to deploy only to staging.
5. A secure secret store for `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`. Never place the API secret in Vite variables, browser code, Git, logs or invitation emails.
6. An operator with SSH and DNS privileges to provision and verify the host.

## Recommended first deployment

Use the official LiveKit VM generator, which produces a Docker Compose and Caddy deployment with TLS and TURN/TLS support. Run this on the operator workstation, not inside a production host:

```bash
mkdir -p livekit-staging-generated
cd livekit-staging-generated
docker pull livekit/generate
docker run --rm -it -v "$PWD:/output" livekit/generate
```

Enter **staging-only** domains and configuration in the generator. Review every generated file before applying it. Pin the LiveKit server image to an explicit release before deploying; do not deploy `latest` for a controlled test. Keep the generated secrets and private configuration outside the repository.

Official deployment instructions: https://docs.livekit.io/transport/self-hosting/vm/

## Configure the IRPA Functions environment

Set the following values in the staging Functions runtime only:

- `LIVEKIT_URL=wss://livekit-staging.<IRPA-controlled-domain>`
- `LIVEKIT_API_KEY=<staging-only key>`
- `LIVEKIT_API_SECRET=<staging-only secret>`

The endpoint and key/secret must belong to the same LiveKit deployment. Redeploy the meeting Functions to staging after the variables are securely configured. Confirm `issueLiveMeetingToken` is deployed in the same Firebase project used by the test web app.

## Configure the protected GitHub preflight

Create a GitHub Actions environment named `livekit-staging` and set:

- Environment variable `LIVEKIT_STAGING_URL` — the canonical `wss://` endpoint.
- Environment secret `LIVEKIT_STAGING_API_KEY`.
- Environment secret `LIVEKIT_STAGING_API_SECRET`.

Then run **LiveKit Staging Endpoint Preflight** manually. This workflow checks that the endpoint uses WSS, that protected credentials exist, and that the endpoint's TLS listener is reachable. It intentionally never prints secrets.

**A passing preflight is not an audio/video acceptance test.** It does not prove that the API key and secret match, that Firebase issues a valid token, or that TURN/network traversal works.

## Two-browser acceptance run

1. Open the deployed staging app in browser A and sign in as the authorized host.
2. Create/select a scheduled staging meeting and issue a meeting invitation to a second test identity.
3. Confirm the real invitation email arrives; verify the meeting link and separately delivered gate password.
4. Open the invitation in browser B (private/incognito window or separate device), sign in as the intended invitee, and pass the invitation gate.
5. In both browsers, run camera/microphone preflight. Grant permissions and confirm the correct camera/microphone are selected.
6. Join the same meeting from A and B. Verify both participant names, local preview, remote video, and two-way audio.
7. Speak in turn and confirm there is no one-way audio. Toggle mute, camera, screen share and leave/rejoin.
8. Check 720p first. Test 1080p only when the camera supports it and bandwidth is stable. Record actual negotiated capture dimensions, frame rate, packet loss, RTT and freezes; do not infer quality from the requested capture resolution.
9. Repeat on an Android phone and a restrictive network. Verify UDP, TCP fallback and TURN/TLS connectivity.
10. Confirm the invitation does not confer chair, secretary, voting or other governance privileges. Verify closed/revoked passes are rejected.

Record the date, build SHA, browser/device, network, invitation delivery result, join result, capture dimensions, audio result, and any errors. Do not use real board-sensitive information for this staging run.

## Acceptance decision

Do not mark the meeting ready until:
- the web app and Firebase Functions are deployed to staging;
- the LiveKit server is reachable over valid TLS;
- a real invitation reaches the intended test account;
- two authenticated browsers join the same room;
- each browser receives remote video and remote audio from the other;
- the run is repeated on mobile and at least one restrictive network;
- the governance privilege boundary remains intact.

If no approved VM/domain/secret store is available, use a separate LiveKit Cloud staging project as the faster alternative, subject to IRPA approval of the provider and any cost/data-residency implications. Do not use LiveKit's local development mode for internet-facing acceptance.
