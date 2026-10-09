# IRPA-DGBS self-hosted LiveKit deployment

## Status

This directory is a deployment runbook, not evidence of a deployed server. LiveKit is not provisioned by GitHub Actions alone. A public VM, DNS control, provider firewall access, and secure deployment access must exist before the endpoint can be brought online.

The implementation follows LiveKit's official single-VM Docker Compose + Caddy deployment approach. Use the official configuration generator instead of maintaining an improvised TLS/TURN topology:
- https://docs.livekit.io/transport/self-hosting/vm/
- https://docs.livekit.io/transport/self-hosting/deployment/

## Proposed topology

- IRPA governance web app: existing Firebase Hosting / React app.
- Meeting-control authorization and short-lived room token: Firebase Functions, `issueLiveMeetingToken`.
- Media plane: IRPA-owned self-hosted LiveKit OSS on a public Ubuntu VM.
- TLS and TURN/TLS: official LiveKit generator's Caddy configuration.
- DNS: a primary meeting hostname and a TURN hostname pointing to the VM's public IPv4.
- Secrets: only in Firebase Functions runtime configuration and GitHub Actions secrets; never in browser source, repository files, build artifacts, or this runbook.

Suggested hostnames (confirm before creating DNS):
- `meet.irpa.or.tz` — LiveKit WebSocket endpoint, normally `wss://meet.irpa.or.tz`.
- `turn.irpa.or.tz` — TURN/TLS domain if the generated configuration asks for it.

Do not create DNS records until a public VM/IP has been selected and IRPA confirms control of the `irpa.or.tz` DNS zone.

## Provisioning requirements

1. A dedicated Ubuntu 22.04/24.04 VM with a public IPv4 address. For a two-person pilot, use at least 2 vCPU and 4 GB RAM as a starting point; choose more capacity for larger meetings and sustained video. This is an initial pilot sizing, not a capacity guarantee.
2. DNS records for the primary and TURN hostnames, both pointing directly to the VM public IP (no HTTP-only proxy in front of WebRTC UDP).
3. Provider firewall and host firewall rules matching the generated LiveKit configuration. The official VM guide lists TCP 80/443, TCP 7881, UDP 3478, and UDP 50000–60000 for its default profile. Do not open extra ports unless the generated configuration requires them.
4. An administrative SSH key or provider-supported cloud-init user data.
5. A dedicated LiveKit API key/secret generated for this deployment.
6. The official LiveKit generator output (`caddy.yaml`, `docker-compose.yaml`, `livekit.yaml`, `redis.conf`, and `init_script.sh` or cloud-init file) retained outside source control if it includes secrets.

## Generate the official VM configuration

Run from a trusted development machine with Docker installed:

```sh
mkdir -p /secure/irpa-livekit-deploy
cd /secure/irpa-livekit-deploy
docker pull livekit/generate
docker run --rm -it -v "$PWD:/output" livekit/generate
```

Follow the generator prompts using the confirmed hostnames and deployment profile. Review the output before provisioning. Do not commit generated secrets or private keys.

## Deploy

Use the generated cloud-init user data when creating the VM, or copy the generated `init_script.sh` to the VM and run it using the official LiveKit procedure. Wait for the service to start and for TLS issuance to complete.

Configure the provider firewall to match the generated config. Confirm DNS resolves to the selected VM and TLS certificates are valid before configuring the app.

## Configure Firebase Functions

The Functions service that exports `issueLiveMeetingToken` must receive these runtime environment values:

- `LIVEKIT_URL`: public secure WebSocket endpoint, e.g. `wss://meet.irpa.or.tz`.
- `LIVEKIT_API_KEY`: the deployment's LiveKit API key.
- `LIVEKIT_API_SECRET`: the matching secret.

Use Firebase Functions runtime secrets/parameters according to the repository's existing deployment convention. Never use Vite-prefixed variables for API secrets. Never place the secret in React code. Deploy the Functions change to an isolated test Firebase project first, then verify the deployed callable reports configured infrastructure and can issue a room-scoped, short-lived token.

## GitHub endpoint probe

The `LiveKit Infrastructure Smoke Test` workflow checks that the endpoint is reachable and that the API key/secret are valid by creating and deleting a uniquely named temporary room. It does not publish camera/microphone media and is not a substitute for browser-to-browser WebRTC.

Set the following GitHub Actions repository secrets after the server is deployed:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

Then run the workflow manually from the deployment branch. Do not paste these values into issues, pull requests, chat, logs, or commits.

## Required acceptance evidence

Do not mark the meeting service live until all are evidenced:

- [ ] DNS A records resolve to the VM and certificate validation succeeds for the endpoint.
- [ ] HTTPS/WSS endpoint responds over the public internet.
- [ ] API probe succeeds with server-side credentials; temporary room is cleaned up.
- [ ] Firebase Functions are deployed to the intended test project with matching runtime values.
- [ ] Host obtains a token through `issueLiveMeetingToken`.
- [ ] Invitation portal issues a participant-specific invitation; link and password arrive in the recipient's mailbox.
- [ ] Invited participant signs in under the expected identity, enters the gate, and joins the same meeting.
- [ ] Two separate real browser sessions publish and receive audio/video in both directions.
- [ ] Candidate 1280×720 video is measured from the received track; actual quality is recorded rather than inferred from the requested capture constraints.
- [ ] UDP media and TCP/TURN fallback are tested; repeat on Android/mobile data or another restrictive network.
- [ ] Unauthorized and revoked invitees cannot receive new room tokens.
- [ ] No Firebase production data or production authorization rules are modified during staging verification.

## Real WebRTC acceptance protocol

Use two separate devices or browsers and separate authenticated identities:

1. Host: open the deployed HTTPS app, sign in, create/select a test meeting, and issue the invitation through the Invitation/Participants portal.
2. Invitee: verify the actual email delivery, open the invitation URL, sign in as the invited identity, enter the separately delivered gate password, and join the exact meeting.
3. Both participants grant camera/microphone permissions. Verify each sees the remote participant and hears the other while speaking; toggle mute and camera to verify state changes.
4. Capture browser console, connection stats (selected ICE candidate type, round-trip time, packet loss, bitrate, received frame dimensions/frame rate), and server logs. Do not save meeting content or record media unless explicitly authorized.
5. Repeat on Android and a separate network. A local-only/fake-device test is useful for regression but does not satisfy real-device acceptance.

## Rollback

Keep the LiveKit service independently disableable. If media fails, disable new live-media joins and use the existing approved fallback meeting channel. Do not change meeting records, voting/quorum logic, Firebase authorization rules, or existing administrators as part of media rollback.
