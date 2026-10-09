# IRPA self-hosted LiveKit media infrastructure

This deployment implements the repository's first controlled VM topology using the official LiveKit Server, embedded TURN, Redis, HTTPS/WSS via Caddy, and Let's Encrypt certificates. It is intended for a single-node pilot; it is not a multi-region or high-availability deployment.

## Required before deployment

1. An Ubuntu 24.04 LTS VM with a stable public IPv4 address. Start with a compute-optimised VM and sufficient bandwidth for simultaneous camera streams.
2. DNS A records for `LIVEKIT_DOMAIN` and `LIVEKIT_TURN_DOMAIN`, both pointing to the VM public IPv4 address. Suggested naming is `meet.<your-domain>` and `turn.<your-domain>`; do not assume these names exist until DNS is configured.
3. Provider firewall rules allowing inbound TCP 22 (SSH), 80, 443, 7881, 5349; UDP 3478 and UDP 50000–60000. Restrict SSH to administrator IP ranges where possible. Ensure the OS firewall does not override the provider firewall.
4. A dedicated API key and random API secret. Never use LiveKit's development credentials `devkey/secret` in a deployed service.
5. GitHub Actions secrets for a deployment host and a pinned SSH host key. The workflow must not use `ssh-keyscan` as a substitute for host-key verification.

## Repository deployment path

The deployment workflow is manual and must be explicitly run after its files are merged to the default branch and the required GitHub Environment approval is configured. It deploys only to the VM named by the protected secrets; it does not deploy the web app or modify Firebase rules.

Configure these repository/environment secrets:

- `LIVEKIT_SSH_HOST`: VM public IP or SSH hostname
- `LIVEKIT_SSH_USER`: deployment user with passwordless sudo for the bootstrap command
- `LIVEKIT_SSH_PRIVATE_KEY`: dedicated SSH private key for this host
- `LIVEKIT_SSH_KNOWN_HOSTS`: pre-verified known-hosts line for the VM
- `LIVEKIT_DOMAIN`: public WebSocket endpoint domain (for example `meet.example.org`)
- `LIVEKIT_TURN_DOMAIN`: TURN/TLS domain (for example `turn.example.org`)
- `LIVEKIT_ACME_EMAIL`: certificate expiry contact
- `LIVEKIT_API_KEY`: dedicated non-production or production API key
- `LIVEKIT_API_SECRET`: high-entropy API secret

The VM deployment writes the API secret only to a root-owned, mode-600 configuration file. The secret is never put in browser code or workflow output. The LiveKit API key/secret must match the Firebase Functions secret values used by `issueLiveMeetingToken`.

## Firebase Functions configuration

The token callable binds `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` as Firebase Functions secrets. After the VM endpoint is reachable, configure these values in the intended Firebase project using the authenticated Firebase CLI, then deploy only the token function from an approved commit:

```sh
firebase functions:secrets:set LIVEKIT_API_KEY --project irpa-digital-board-governance
firebase functions:secrets:set LIVEKIT_API_SECRET --project irpa-digital-board-governance
```

Supply the exact same key and secret used by the LiveKit server. Configure `LIVEKIT_URL=wss://<LIVEKIT_DOMAIN>` in the project-specific Functions environment file or Firebase parameter configuration, then deploy the callable. Do not print secrets into CI logs. Updating a secret requires redeploying the function that binds it.

## Ports and transport

- TCP 80: Let's Encrypt HTTP-01 issuance/renewal
- TCP 443: HTTPS/WSS signalling through Caddy
- TCP 7881: WebRTC TCP fallback
- UDP 3478: TURN/UDP
- TCP 5349: TURN/TLS
- UDP 50000–60000: WebRTC media

The bootstrap script installs Docker, obtains the certificate for both DNS names, generates the LiveKit config from the template, starts the services, and installs a daily certificate-renewal timer. It does not change Firebase authorization rules or the governance database.

## Acceptance gate

A successful deployment script or HTTPS response is not an end-to-end meeting test. Before declaring readiness, verify all of the following:

1. `wss://<LIVEKIT_DOMAIN>` is reachable with a valid certificate.
2. LiveKit server logs show the configured API key was loaded (never log the secret).
3. A server-issued token for a specific meeting can connect.
4. Host and invitee tokens resolve to the same room name for the same meeting and different identities.
5. Two independent authenticated browsers join concurrently and each sees the other participant.
6. Both browsers publish microphone audio and camera video, receive remote tracks, and can toggle mic/camera.
7. Test normal UDP, TCP fallback, and TURN/TLS from a restrictive network.
8. Confirm a real 720p-capable stream in browser stats; the capture target does not guarantee delivered 720p under constrained bandwidth.
9. Verify Android/mobile layout, reconnection, disconnect, and meeting closure.
10. Confirm token secrets are never sent to the browser, logs, or repository.

## References

- LiveKit VM deployment guide: https://docs.livekit.io/transport/self-hosting/vm/
- LiveKit self-hosting overview: https://docs.livekit.io/transport/self-hosting/
- LiveKit release pin: `livekit/livekit-server:v1.13.7`

This is a single-node pilot deployment, not an SLA-backed or multi-node production cluster. Before scaling beyond a pilot, review CPU/bandwidth benchmarks, monitoring, backups, upgrade/rollback, TURN/TLS on TCP 443 for restrictive enterprise networks, and a separate Egress worker if recording is approved.
