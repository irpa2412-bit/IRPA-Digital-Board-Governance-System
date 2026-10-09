# IRPA-DGBS Live Meeting Infrastructure

This directory is the infrastructure boundary for the IRPA-owned live meeting media service.

## Design
- Self-hosted LiveKit OSS for WebRTC media.
- IRPA-DGBS remains the governance authority.
- Firebase/Firestore remains the governance data layer.
- Browser receives short-lived participant credentials only.
- API secrets remain on the meeting-control server.
- Recording is optional and policy-controlled.
- Firebase production does not need to be disabled to deploy this layer.

## Current status
Architecture prepared; isolated staging deployment preparation is in progress. Actual VM provisioning and endpoint verification remain blocked pending DigitalOcean account-limit/billing reconciliation, SSH-key setup, and DNS verification.

No production meeting server, DNS record, API secret or Firebase administrator setting is changed by these repository files.

## Deployment prerequisites
- Dedicated public VM or equivalent.
- DNS verification for meet.irpa.or.tz and turn.irpa.or.tz. Do not change existing production records; any new staging-only records require explicit review.
- TLS.
- Firewall access for configured WebRTC/TURN ports.
- Server-side LiveKit credentials.
- Meeting-control gateway credentials.
- Monitored storage for authorized recordings.

## Safety rule
Do not put production secrets in this repository. Use the deployment host secret store/environment.

## Rollback
Stop the media service and remove only the meeting-media integration route. Do not modify Firebase Auth, Firestore governance records, existing administrator claims, or meeting records during rollback.

## Isolated staging deployment preparation
See [STAGING_ACCEPTANCE.md](./STAGING_ACCEPTANCE.md) and [docker-compose.staging.yml](./docker-compose.staging.yml). The Compose file is a staging scaffold, not evidence of a deployed service. Do not start LiveKit until the TURN certificate exists and the `livekit.yaml` file contains server-generated credentials with restrictive permissions. Never commit the real `.env` or `livekit.yaml`.
