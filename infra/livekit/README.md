# IRPA self-hosted LiveKit staging

This is the deployment package for IRPA's self-hosted LiveKit OSS media plane. It is separate from Firebase governance data and must first be deployed to a dedicated staging VM.

## Prerequisites that must exist outside GitHub

- A dedicated Ubuntu 22.04/24.04 VM with a public IPv4 address, sufficient CPU/network bandwidth, and SSH access.
- Two DNS names pointing to that VM: one for the WebSocket/API endpoint and one for TURN/TLS.
- The cloud firewall/security group and host firewall must allow inbound TCP 80, 443, 7881, 5349; UDP 3478 and 50000–60000. Verify these against the selected provider and current LiveKit documentation.
- Unique LiveKit API key and secret. Never use LiveKit development credentials.
- A valid contact email for Let's Encrypt.
- A deployment identity with root/sudo access to the dedicated VM.

LiveKit's official VM guidance requires a domain and DNS control, and uses Docker Compose/Caddy for TLS. Its recommended WebRTC connectivity includes TCP 7881, UDP media ports 50000–60000, TURN/UDP 3478, and HTTPS/TURN TLS. See [LiveKit VM deployment](https://docs.livekit.io/transport/self-hosting/vm/) and [ports/firewall](https://docs.livekit.io/transport/self-hosting/ports-firewall/).

## Deployment

The script `deploy-staging.sh` installs Docker if needed, configures Caddy for the secure WebSocket endpoint, obtains the TURN host certificate with Certbot, and starts LiveKit with server-side credentials. Run it only on the dedicated staging VM with the required environment variables. Review the generated host firewall rules with the cloud provider before opening the service publicly.

Required environment variables:

- `LIVEKIT_DOMAIN` — e.g. the IRPA-owned meeting subdomain chosen by the organization.
- `LIVEKIT_TURN_DOMAIN` — a separate DNS name on the same VM.
- `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` — unique credentials.
- `ACME_EMAIL` — certificate expiry contact.

Example invocation on the target VM (do not paste real secrets into tickets or chat):

```bash
sudo env LIVEKIT_DOMAIN='live.example.org' \
  LIVEKIT_TURN_DOMAIN='turn.example.org' \
  LIVEKIT_API_KEY='replace-with-unique-key' \
  LIVEKIT_API_SECRET='replace-with-unique-secret-of-32-plus-characters' \
  ACME_EMAIL='operations@example.org' \
  bash ./deploy-staging.sh
```

The example domains and credentials are placeholders, not IRPA's configured values.

## Firebase Functions secret binding

The `issueLiveMeetingToken` callable reads `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` from Firebase Secret Manager using function-bound secret parameters. For the **staging Firebase project only**, create/set those three secrets and deploy the callable. Do not point the test deployment at the production Firebase project until separately approved.

## Verification gates

1. DNS for both names resolves to the VM public IP; the primary endpoint has valid trusted TLS.
2. `LIVEKIT_URL=wss://<primary-domain>` with the API key/secret passes `node functions/scripts/verify-livekit-control-plane.js`. This proves authenticated control-plane reachability, not media.
3. An authenticated IRPA host issues an invitation; the intended test participant receives it and signs in using their own account.
4. Both browsers open the invitation gate, authorize the same meeting, obtain distinct short-lived tokens, and join the same room.
5. Both browsers publish microphone and camera tracks; each sees/hears the other. Confirm the selected video resolution and actual connection stats rather than assuming HD from the requested capture constraints.
6. Repeat with Android/mobile, UDP blocked/TCP fallback, and TURN/TLS path; inspect browser WebRTC stats and LiveKit logs.
7. Verify unauthorized/revoked invitees cannot obtain tokens, then retain the test results.

## Important limitations

The deployment script creates a **single-node staging pilot**, not a high-availability production cluster. It does not create a VM, reserve a public IP, control DNS, modify cloud security groups, or create Firebase/GitHub secrets. Those require authorized infrastructure account access. A running container or successful API health check is not proof of a successful end-to-end WebRTC call. TURN/TLS on TCP 5349 must be tested from actual client networks; if the chosen network requires TURN/TLS on 443, use the official LiveKit VM generator/load-balancer topology rather than treating 5349 as sufficient.


## GitHub Actions setup for staged deployment

Configure these **repository Actions secrets** in GitHub before running the manual workflows:

**Media VM deployment** (`Deploy IRPA Self-Hosted LiveKit Staging`):
- `LIVEKIT_STAGING_SSH_HOST`
- `LIVEKIT_STAGING_SSH_USER`
- `LIVEKIT_STAGING_SSH_PRIVATE_KEY`
- `LIVEKIT_STAGING_SSH_KNOWN_HOSTS` — pre-verified host key; do not disable host-key checking.
- `LIVEKIT_STAGING_DOMAIN`
- `LIVEKIT_STAGING_TURN_DOMAIN`
- `LIVEKIT_STAGING_API_KEY`
- `LIVEKIT_STAGING_API_SECRET`
- `LIVEKIT_STAGING_ACME_EMAIL`

**Firebase callable deployment** (`Deploy IRPA LiveKit Staging Function`):
- `LIVEKIT_STAGING_FIREBASE_PROJECT_ID` — a dedicated non-production Firebase project.
- `LIVEKIT_STAGING_FIREBASE_SERVICE_ACCOUNT` — JSON service account with permission to enable required APIs, manage Secret Manager versions, and deploy Cloud Functions in that staging project.
- `LIVEKIT_STAGING_URL` — the deployed endpoint in `wss://` form. It should match the VM deployment's primary domain.
- The same `LIVEKIT_STAGING_API_KEY` and `LIVEKIT_STAGING_API_SECRET` as the VM deployment.

**Verification** (`Verify IRPA LiveKit Staging Control Plane`):
- `LIVEKIT_STAGING_URL`
- `LIVEKIT_STAGING_API_KEY`
- `LIVEKIT_STAGING_API_SECRET`

Run in this order: deploy media VM; verify TLS/network; deploy the callable to the staging Firebase project; run control-plane verification; then complete the real two-browser WebRTC acceptance test. These workflows are manual and are not triggered by merging this PR. A GitHub workflow cannot proceed successfully until all secrets and the dedicated host/project exist.
