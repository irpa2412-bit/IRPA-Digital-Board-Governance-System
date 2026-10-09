# IRPA self-hosted LiveKit — isolated staging

This is an infrastructure scaffold for a dedicated media-only staging host. It does not deploy itself and must not be treated as a live endpoint until the deployment gates below are complete.

## Isolation boundary

- This host runs LiveKit media only. It must not receive a production Firestore service account, production Firebase Admin credentials, governance exports, or production database access.
- The IRPA Firebase Functions token issuer should receive only the staging LiveKit URL, API key, and API secret through the approved staging secret store.
- Keep the candidate app and functions on staging configuration until two-browser acceptance passes.
- Do not enable recording/Egress by default.

## Proposed host and cost

Initial pilot sizing: DigitalOcean `s-4vcpu-8gb` (4 vCPU, 8 GB RAM, 160 GB disk), listed at approximately **US$48/month** before taxes, bandwidth overages, backups, and other charges. Singapore (`sgp1`) is a candidate region for East African participants, subject to latency testing and account availability. This is a planning estimate, not a purchase authorization.

The connected DigitalOcean account currently reports the droplet limit reached and no registered SSH keys. Resolve the account limit and register a trusted public SSH key before provisioning. Never create a droplet with password-only or publicly exposed SSH access.

## DNS required

After the VM has a stable public IPv4 address, create these records in the authoritative DNS provider for `irpa.or.tz`:

- `A meet.irpa.or.tz -> <staging VM IPv4>`
- `A turn.irpa.or.tz -> <staging VM IPv4>`

Do not create the records until the actual host IP is assigned. Avoid an AAAA record unless IPv6 routing and firewall policy have been tested.

## Required ports

- TCP 80 and 443: certificate issuance/HTTPS signaling reverse proxy.
- TCP 7881: LiveKit WebRTC TCP fallback.
- UDP 3478: LiveKit TURN/UDP.
- TCP 5349: LiveKit TURN/TLS.
- UDP 50000–60000: WebRTC media (confirm the exact range against the rendered server config).

Restrict SSH TCP 22 to approved operator IP ranges. Configure both DigitalOcean Cloud Firewall and the host firewall; do not assume one replaces the other.

## Host prerequisites

Ubuntu LTS, trusted SSH public key, Docker Engine and Compose plugin, Python 3, Certbot, UFW, time synchronization, and a non-root deployment account with narrowly scoped sudo.

Before issuing a certificate:
1. Confirm both DNS A records point to the host.
2. Confirm inbound TCP 80 is reachable.
3. Obtain one certificate covering both names, using Certbot's standalone mode and the name `irpa-livekit`:
   `sudo certbot certonly --standalone --cert-name irpa-livekit -d meet.irpa.or.tz -d turn.irpa.or.tz`
4. Keep renewal operational. Because standalone renewal needs port 80, use a reviewed pre/post renewal hook to stop and restart the Caddy container, and test renewal with `certbot renew --dry-run`.

## Configure and start

1. Copy this directory to the dedicated staging host.
2. Create `.env` from `.env.example`; set a reviewed/pinned LiveKit image version and generate unique credentials using a cryptographically secure random generator. Do not paste secrets into GitHub files or chat.
3. Render the server configuration: `./render-config.sh`.
4. Review `runtime/livekit.yaml` locally, then start: `docker compose up -d`.
5. Inspect logs and host listeners. Confirm LiveKit is healthy and TURN is bound on the expected ports.
6. Check signaling locally with `curl -i http://127.0.0.1:7880/` and inspect LiveKit logs; do not rely on a container health label as the acceptance signal.\n7. Configure the staging Firebase Functions environment with `LIVEKIT_URL=wss://meet.irpa.or.tz`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` using the approved secret-management process. Never place the secret in Vite/client environment variables.
8. Deploy only the staging Functions project and staging app. Do not use the production Firebase project or production Firestore.

## Acceptance gates — all must pass

- [ ] DNS resolution for both names points to the intended staging host.
- [ ] Valid TLS certificate covers both names and renewal dry-run passes.
- [ ] HTTPS/WebSocket signaling works through `wss://meet.irpa.or.tz`.
- [ ] LiveKit server reports healthy and TURN ports are reachable externally.
- [ ] Staging token issuer accepts an authorized test participant and issues a short-lived room-scoped token.
- [ ] An unauthorized participant and wrong-meeting token request are denied.
- [ ] Two independently authenticated browsers join the same authorized meeting.
- [ ] Audio publishes and is heard in both directions.
- [ ] Video publishes and is seen in both directions; inspect actual negotiated resolution and frame rate rather than assuming 720p from a capture constraint.
- [ ] Test UDP media, TCP fallback, and TURN/TLS from a restrictive network.
- [ ] Android mobile test passes with permissions, mute/unmute, camera on/off, reconnect, and orientation changes.
- [ ] Close/revoke meeting access and verify new token requests are denied.
- [ ] Confirm no production governance data or credentials were exposed to the media host.

## Rollback

Stop the staging compose stack; remove the staging-only LiveKit secrets from the staging Functions configuration; preserve logs needed for diagnosis; and leave Firebase governance records untouched. Do not point production clients at this host before explicit acceptance and a separately approved release.

## Important limitations

This scaffold does not itself configure the domain's DNS provider, open cloud firewall rules, create certificates, provision a VM, install Docker, deploy Firebase Functions, or prove media quality. Those require the account-side steps and controlled end-to-end tests described above.
