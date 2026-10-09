# IRPA Live Meeting — Isolated Staging Acceptance

This runbook is for a dedicated staging VM only. Do not point production application traffic at it, alter production Firebase data/rules, or change existing production DNS records without a separate change approval.

## Current external blockers
- DigitalOcean API reports the team at its three-Droplet limit and warns that the limit must be resolved in the control panel. The API's Droplet list currently returns no Droplets, so the displayed limit and inventory are inconsistent and must be reconciled in the selected team.
- The connected account has no SSH keys available through the API.
- The account balance/usage response is $0.00; confirm billing is active before provisioning.
- No DNS provider access is available through the connected DigitalOcean actions. The existing records for `meet.irpa.or.tz` and `turn.irpa.or.tz` have not been verified or changed.
- No LiveKit server credentials or reachable deployed endpoint have been verified.
- Paid backups remain disabled/deferred by approval.

## Approved cost boundary
Compute only, up to US$24/month. Do not create paid backups, load balancers, managed databases, volumes, reserved IPs, or other paid resources without separate approval. Keep the first deployment on one VM and avoid optional recording/transcription services.

## Provisioning gate
1. In DigitalOcean, select the intended team and reconcile the Droplet limit warning with the Droplet inventory. Submit a Droplet-limit increase request or contact DigitalOcean support; do not delete unrelated resources to free capacity.
2. Confirm billing/payment method is active and the exact VM size is available for no more than US$24/month compute. The API offers a 2-vCPU/4-GB basic plan at US$24/month in several regions; availability must be checked in the selected region before creation.
3. Add a dedicated SSH public key to the account; keep the private key outside the repository and never share it in chat.
4. Verify the authoritative DNS provider and existing A/AAAA/CNAME records for both requested hostnames. Do not change existing records. Any new staging-only record must be explicitly identified as a new subdomain record and reviewed before creation.
5. Provision a dedicated Ubuntu VM with backups disabled, monitoring enabled only if included at no extra cost, and a unique staging tag. No production governance datastore credentials belong on this VM.

## Host bootstrap and network
- Apply security updates; install Docker Engine and Compose plugin from trusted packages.
- Restrict SSH to key authentication; preserve SSH access before enabling host firewall.
- Permit TCP 80/443, TCP 7881, TCP 5349, UDP 3478 and UDP 50000–60000. Do not expose Redis or the LiveKit internal API port 7880 directly to the public internet.
- Keep Redis on the private Compose network only.
- Use TLS for web signaling and TURN/TLS. Never expose the LiveKit API secret to the browser.
- Configure the LiveKit TURN certificate from Certbot only after DNS points to this staging VM and HTTP challenge validation succeeds.

## Service startup sequence
1. Copy `livekit.yaml.example` to `livekit.yaml` on the VM and replace the placeholder API key/secret with server-generated values. Set file permissions to 0600. Never commit this file.
2. Copy `.env.staging.example` to `.env`; replace the image placeholder with an approved version or digest and set an operational ACME email.
3. Start Redis and Caddy first; confirm both hostnames resolve to the staging VM and the ACME HTTP challenge works.
4. Issue the TURN certificate with the Compose Certbot profile for `turn.irpa.or.tz`. Then start LiveKit and Caddy. Confirm certificates renew and reload/restart LiveKit safely when TURN certificates renew.
5. Set Firebase Functions secrets `LIVEKIT_URL=wss://meet.irpa.or.tz`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` only in the isolated staging Firebase project. Do not deploy these secrets to the production project during acceptance.
6. Deploy the candidate Meeting Control Functions to the isolated staging Firebase project only. Keep production Firebase Auth, Firestore, invitation delivery and DNS untouched.

## Required acceptance evidence
- DNS and TLS: both hostnames resolve to the staging IP; certificate subject/SAN and expiry are valid.
- Endpoint: `https://meet.irpa.or.tz` and secure WebSocket signaling are reachable; TURN/TLS certificate is valid.
- Credentials: a server-side LiveKit API request and token mint succeed; invalid credentials fail; no secret appears in browser/network payloads or logs.
- Invitation: a host issues a meeting-specific invitation; the invited test identity receives the email, authenticates, enters the password, and reaches only the invited meeting.
- WebRTC: two separate authenticated browser sessions join the same room; each publishes microphone and camera; both see/hear the other participant; mute/camera toggles and disconnect/rejoin work.
- Network: test UDP media, TCP fallback, TURN/UDP and TURN/TLS from a restrictive network. Confirm ICE candidate selection and successful media, not merely successful signaling.
- Responsive: test desktop and Android mobile viewport/device, permission denial/retry, and network interruption/recovery.
- Governance isolation: verify no writes to production Firebase project and no changes to existing administrators, invitation records, quorum/voting or governance data.
- Rollback: disable the staging media endpoint without modifying meeting governance data.
- Attach timestamps, sanitized logs, browser console/network evidence, ICE transport/candidate type, and pass/fail results to the acceptance report.

## Stop conditions
Do not call the meeting production-ready until every mandatory acceptance item above passes. Do not alter production DNS, deploy production Functions, or merge the media infrastructure to `main` as part of this staging exercise.
