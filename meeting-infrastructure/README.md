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
Architecture prepared; production installation is pending infrastructure credentials and host provisioning.

No production meeting server, DNS record, API secret or Firebase administrator setting is changed by these repository files.

## Deployment prerequisites
- Dedicated public VM or equivalent.
- DNS for meet.irpa.or.tz and turn.meet.irpa.or.tz.
- TLS.
- Firewall access for configured WebRTC/TURN ports.
- Server-side LiveKit credentials.
- Meeting-control gateway credentials.
- Monitored storage for authorized recordings.

## Safety rule
Do not put production secrets in this repository. Use the deployment host secret store/environment.

## Rollback
Stop the media service and remove only the meeting-media integration route. Do not modify Firebase Auth, Firestore governance records, existing administrator claims, or meeting records during rollback.