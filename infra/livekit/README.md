> **Canonical deployment boundary:** `infra/livekit/` is the only active LiveKit deployment configuration. The older `meeting-infrastructure/` examples and the duplicate functions-only deployment workflow are retired. Use only `.github/workflows/deploy-livekit-staging.yml`; deployment requires the protected `livekit-staging` environment and the explicit marker/confirmation. Do not deploy until provider account, billing, SSH, DNS, firewall and isolated Firebase prerequisites are verified.

# IRPA self-hosted LiveKit — isolated staging

This package deploys the LiveKit OSS media plane on a dedicated VM, isolated from production governance data. It does not deploy the web app, alter Firebase authorization rules, or use production Firestore data.

## Deployment topology

- `meet.irpa.or.tz`: HTTPS/WSS signalling endpoint.
- `turn.irpa.or.tz`: TURN/TLS endpoint.
- LiveKit Server `v1.13.7`, LiveKit Egress `v1.13.0`, Redis 7.4, and the official `livekit/caddyl4:v2.11.4` image. Egress is required for room-composite recordings; the server alone cannot process these recording requests.
- Caddy's Layer 4 SNI routing multiplexes meeting WSS and TURN/TLS over TCP/443; LiveKit's embedded TURN/UDP remains on UDP/3478.
- WebRTC media uses UDP/50000–60000 with TCP/7881 fallback.
- Caddy obtains and renews certificates for both names automatically.

This follows the official [LiveKit VM deployment guide](https://docs.livekit.io/transport/self-hosting/vm/) and its [Caddy L4 configuration generator](https://github.com/livekit/deploy/tree/main/generate).

## Required before deployment

1. A dedicated Ubuntu 22.04/24.04 VM with a public IPv4 address and SSH access. LiveKit room-composite Egress is resource-intensive; LiveKit recommends at least 4 CPUs and 4 GB RAM for each Egress instance. Verify the existing host meets this before enabling recordings; do not provision or resize a VM without the previously required explicit spending approval.
2. DNS A records for `meet.irpa.or.tz` and `turn.irpa.or.tz`, both pointing to the VM. The installer refuses to run if either record does not resolve to the target VM.
3. Provider and host firewall rules: TCP 22 (restricted to trusted admin IPs), 80, 443, 7881; UDP 3478 and 50000–60000. TCP/5349 is an internal LiveKit TURN listener behind Caddy and should not be exposed publicly. Check the current provider firewall before opening ports.
4. Unique, high-entropy LiveKit API credentials. Never use `devkey/secret`.
5. A valid ACME contact email and a deployment SSH identity whose host key has been independently verified.
6. A separate Firebase staging project, with test-only meeting/participant data, authenticated test identities, and staging mail configuration. Do not point the test callable at `irpa-digital-board-governance`.

## VM deployment workflow

The GitHub Actions workflow is `Deploy IRPA Self-Hosted LiveKit Staging`. It requires the protected `livekit-staging` GitHub Environment. On the staging feature branch or collective integration branch, ordinary pushes skip deployment; only a commit whose message begins `DEPLOY-LIVEKIT-STAGING:` can start the staging deployment, and the protected environment must approve it. The manual `DEPLOY-LIVEKIT-STAGING` input is available when workflow dispatch is enabled from the default branch. Do not use the marker until the account limit, spending, VM, DNS, firewall and staging secrets are all approved and ready.

Configure these environment/repository secrets through the approved secret-management UI (never in chat or source files):

- `LIVEKIT_STAGING_SSH_HOST`
- `LIVEKIT_STAGING_SSH_USER`
- `LIVEKIT_STAGING_SSH_PRIVATE_KEY`
- `LIVEKIT_STAGING_SSH_KNOWN_HOSTS` — pre-verified host key; do not substitute `ssh-keyscan`
- `LIVEKIT_STAGING_DOMAIN` — `meet.irpa.or.tz`
- `LIVEKIT_STAGING_TURN_DOMAIN` — `turn.irpa.or.tz`
- `LIVEKIT_STAGING_API_KEY`
- `LIVEKIT_STAGING_API_SECRET`
- `LIVEKIT_STAGING_ACME_EMAIL`
- `LIVEKIT_STAGING_FIREBASE_PROJECT_ID` — must be a dedicated non-production project
- `LIVEKIT_STAGING_FIREBASE_SERVICE_ACCOUNT` — staging-only service account with minimum deployment permissions

The workflow refuses the known production Firebase project. It deploys the media host and only the `issueLiveMeetingToken` callable to the isolated staging Firebase project. It does not deploy Firebase Hosting or change Firestore/Storage rules.

## Cloudflare Worker secrets and private R2 recording storage

The meeting Worker is the privileged control plane. Its LiveKit API credentials are stored as Cloudflare Worker secrets, not in browser code, `wrangler.toml`, Git, or logs. The self-hosted LiveKit server and Egress service must also retain the same LiveKit API key/secret in their root-only host configuration because they validate and process media/control requests. Do not remove the VM-side copies or rotate only one side; a coordinated rotation is required.

Meeting recordings are stored in a **private Cloudflare R2 bucket** using LiveKit Egress's S3-compatible output. The Egress process writes directly to R2; the Worker does not proxy the video bytes and no public bucket access is required. R2 access credentials are held only as Cloudflare Worker secrets and are sent in the authenticated Egress start request over HTTPS. They are not copied to the VM's `.env` file.

Recommended bucket name: `irpa-dbgs-meeting-recordings`. The object-key prefix is `irpa-governance-recordings/<meeting-id>/<timestamp>.mp4`. Configure a bucket-scoped R2 API token with **Object Read & Write** limited to this bucket, not an account-wide administrative token. R2's S3 endpoint format is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, and the region must be `auto`. Set `force_path_style=true`. Keep the bucket private and use an authorized download flow; do not publish recordings through a public R2 URL.

The production GitHub Environment named `production` must have these secrets before the manual `Bind LiveKit and R2 Secrets to Cloudflare Worker` workflow can run:

- `LIVEKIT_URL` — secure LiveKit endpoint, normally `wss://meet.irpa.or.tz`.
- `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` — the same credentials configured on the self-hosted LiveKit server.
- `LIVEKIT_EGRESS_R2_ENDPOINT` — HTTPS R2 S3 endpoint for the IRPA account.
- `LIVEKIT_EGRESS_R2_BUCKET` — the private recording bucket name.
- `LIVEKIT_EGRESS_R2_ACCESS_KEY_ID` and `LIVEKIT_EGRESS_R2_SECRET_ACCESS_KEY` — bucket-scoped R2 credentials.
- `LIVEKIT_EGRESS_R2_REGION` — exactly `auto`.
- Existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets for the Worker account.

The workflow validates these values without printing them, then binds them as Cloudflare Worker secrets using Wrangler. Do not send any of these values through chat or commit them to source control.

**Provisioning boundary:** R2 must be enabled/purchased in the account and the bucket/token created before this workflow can succeed. This repository change does not create the bucket, purchase R2, change DNS, provision a VM, or deploy the stack. Those steps remain blocked until the account prerequisites and spending approval are resolved.

## Firebase secret binding

The callable binds `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` through Firebase Functions Secret Manager. The staging workflow sets them in the staging project and deploys only `issueLiveMeetingToken`. API secrets remain server-side and are never sent to the browser.

## Acceptance gates

1. Verify both DNS records point to the VM and Caddy obtains trusted certificates.
2. Verify `https://meet.irpa.or.tz/` is reachable and `wss://meet.irpa.or.tz` passes an authenticated LiveKit RoomService API probe.
3. Confirm the deployed staging callable issues separate short-lived participant tokens that reference the same deterministic room for one meeting.
4. Send a real invitation through the Invitation Portal's authenticated mail gateway; confirm the invited participant receives the link and separate gate password.
5. Use two separate authenticated browser sessions (host and invitee). Join the same meeting and confirm each browser publishes microphone and camera tracks and receives the other participant's audio/video.
6. Inspect browser WebRTC stats for actual negotiated resolution, frame rate, packet loss and selected candidate pair. A 720p/1080p capture request is not proof of actual HD quality.
7. Repeat on Android/mobile and with UDP blocked to verify TCP fallback and TURN/TLS connectivity; inspect LiveKit logs.
8. Confirm revoked/wrong-meeting invitations cannot obtain a media token. Keep the invitation portal workflow unchanged.
9. Verify no production governance records were read or written and preserve test evidence.

A healthy HTTPS endpoint or authenticated control-plane API does not prove browser-to-browser media. Do not declare staging acceptance until the real two-browser test passes.

## Cost and provisioning boundary

This is a single-node staging pilot, not a high-availability production cluster. VM compute, backups, bandwidth, tax and any add-ons incur provider costs. The deployment workflow does not provision a VM, edit DNS, or change provider firewalls; those are separate controlled steps requiring account access and explicit spending approval.

## Rollback

Use the protected staging deployment environment to stop/disable the media stack and remove the staging-only callable/secret versions if necessary. Keep production governance data, production Firebase rules and the Invitation Portal untouched. Do not delete the VM until logs and acceptance evidence have been retained.
