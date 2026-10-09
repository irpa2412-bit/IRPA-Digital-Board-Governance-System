# IRPA self-hosted LiveKit — isolated staging deployment

## Purpose and isolation boundary

This runbook establishes the LiveKit media layer for a controlled IRPA-DBGS staging acceptance test. It does **not** deploy to production, change Firebase authorization rules, or move governance records. The staging Meeting Room Functions must use a dedicated Firebase staging project and its own Firestore/Auth data. Do not deploy the staging Functions to `irpa-digital-board-governance` or point them at production data.

The Invitation Portal remains the existing source for issuing and dispatching meeting invitations. This media layer supplies real-time WebRTC only; it does not own membership, quorum, voting, resolutions, attendance authority, or approved minutes.

## Forensic findings to resolve before accepting a live meeting

1. The repository contains the LiveKit token issuer and browser media client, but the documented self-hosted media endpoint has not been proven deployed/reachable.
2. The token issuer previously read `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from `process.env` without binding them as Firebase Functions v2 secrets. This branch explicitly binds both Secret Manager values to `issueLiveMeetingToken`.
3. A successful app build or token function test is not proof of media transport. Real browser-to-browser tests must verify audio/video publication and subscription, UDP, TCP fallback, and TURN/TLS from at least one restrictive network.
4. No DNS edits or cloud resources are made by this repository change. Existing DNS records must be inspected before adding or replacing records.

## Proposed staging host and cost gate

- Provider: DigitalOcean.
- Hostname intent: `meet.irpa.or.tz` for the LiveKit signalling/API endpoint and `turn.irpa.or.tz` for TURN/TLS.
- Suggested initial VM profile: Ubuntu LTS, 2 vCPU / 4 GB RAM, 80 GB disk, region `blr1` (Bangalore; confirm current availability before provisioning).
- Retrieved DigitalOcean catalog price for `s-2vcpu-4gb`: **US$24/month** compute, approximately US$0.03571/hour; backups, taxes, transfer overages or other add-ons may increase the bill. This is a planning estimate, not a final invoice.
- No new VM may be created until spending is explicitly approved and the account's Droplet-limit warning is resolved. At inspection, the connected account reported a zero balance, a warning that the Droplet limit had been reached, and no SSH keys; the Droplet list response was empty. Resolve this mismatch in the DigitalOcean control panel before attempting creation.
- Create/import a dedicated SSH public key first. Never place private keys, DigitalOcean tokens, LiveKit secrets, Firebase credentials, or TURN credentials in Git.

## Deploy using the official LiveKit VM generator

Use the official LiveKit self-hosting VM generator and review its generated files before deploying. Official guide: https://docs.livekit.io/transport/self-hosting/vm/

1. Verify account billing and Droplet limits; obtain spending approval.
2. Inspect authoritative DNS for `irpa.or.tz`. Record existing A/AAAA/CNAME/CAA values and TTLs for both requested hostnames. Do not overwrite existing records. Only after the dedicated staging VM has a stable public IPv4 address and approval, create/adjust the required records with the actual DNS provider:
   - `meet.irpa.or.tz A <staging-vm-ip>`
   - `turn.irpa.or.tz A <staging-vm-ip>`
   If either name is already in use, stop and agree a non-conflicting staging hostname instead.
3. Generate the official LiveKit VM configuration for both hostnames using the upstream generator. Review `cloud-init`, Docker Compose, LiveKit and Caddy settings. Do not substitute the insecure `livekit-server --dev` mode.
4. Provision the isolated VM with the generated cloud-init only after the approved VM and DNS prerequisites are satisfied. Use host firewall and any cloud firewall to permit only the required services:
   - TCP 80/443 for ACME and HTTPS/WSS/TURN-TLS.
   - TCP 7881 for WebRTC TCP fallback.
   - UDP 3478 for TURN/UDP if enabled.
   - UDP 50000–60000 for WebRTC media (or the exact configured range).
   - Do not expose Redis, Docker, SSH, metrics, or admin interfaces to the public internet. Restrict SSH to known administrator IPs where practical.
5. Confirm trusted TLS certificates for both names and verify the LiveKit service and TURN listener. The TURN hostname must match the configured TURN TLS domain/certificate.
6. Generate a dedicated LiveKit API key/secret for this staging instance. Store the key and secret in the **staging Firebase project** Secret Manager:
   ```sh
   firebase use <IRPA_STAGING_FIREBASE_PROJECT_ID>
   firebase functions:secrets:set LIVEKIT_API_KEY
   firebase functions:secrets:set LIVEKIT_API_SECRET
   ```
   Supply values through the interactive secure prompt; do not paste them into command-line arguments, repository files, chat, or logs. Set `LIVEKIT_URL=wss://meet.irpa.or.tz` in the staging Functions environment using the approved project-specific environment configuration.
7. Deploy only the Meeting Room callable/function code to the dedicated staging Firebase project. Confirm `issueLiveMeetingToken` is deployed with both secrets explicitly bound. Never bind the staging LiveKit credentials to production Functions.
8. Run `scripts/check-livekit-endpoint.sh` from a network outside the VM. This checks DNS, HTTPS/TLS and a TURN/TLS TCP/TLS handshake; it does not prove TURN allocation or a WebRTC call.
9. Perform the interactive acceptance test below. Keep the staging endpoint and test data isolated until every required item passes.

## Interactive browser-to-browser acceptance

Use two separate devices/browser profiles and separate authenticated accounts: one authorized host and one invited participant. Use the existing Invitation Portal to issue and deliver a meeting-specific link and gate password.

- Both accounts authenticate; the invitee opens the email link and enters the gate password.
- Invitation authorization resolves the exact meeting and participant.
- `issueLiveMeetingToken` returns a short-lived room-scoped token; the browser never sees the API secret.
- Both browsers join the same meeting; each sees the other participant.
- Both publish camera and microphone; verify remote picture and two-way audio for at least 3 minutes.
- Verify camera at 1280×720 target where device/network support it; capture actual track settings and browser stats. Never label the call “HD verified” solely because 720p was requested.
- Test mute/unmute, camera on/off, participant leave/rejoin, and mobile layout.
- Test normal UDP, TCP fallback, and TURN/TLS from a restrictive network (for example, mobile data or a network where UDP is blocked).
- Verify invalid, revoked, expired, wrong-meeting and wrong-identity invitation attempts cannot receive a media token.
- Confirm invitation dispatch still works, meeting access is auditable, and production governance records remain untouched.
- Record outcomes, timestamps, client/browser/device/network details, selected candidate transport (UDP/TCP/relay), actual resolution/frame rate, and any failures without recording access tokens or secrets.

## Rollback

Stop or disable the staging LiveKit service and remove only the staging DNS records created for this rollout. Keep invitation issuance and governance records intact. Do not delete or rewrite production meetings, invitations, participants, audit logs, or Firebase authorization rules.

## Current readiness status

- Repository-side secret binding: implemented on this branch; must pass CI and be merged to the integration branch before staging Functions deployment.
- VM provisioned: **blocked** — explicit spending approval is pending and DigitalOcean reports a Droplet-limit warning.
- DNS verified/changed: **not done** — authoritative DNS provider access is not available through the current connected tools; existing records must be checked before editing.
- LiveKit TLS/endpoint reachable: **not done**.
- Firebase staging secrets/function deployed: **not done**.
- Browser-to-browser WebRTC and HD: **not verified**.
- Production: **not deployed**.
