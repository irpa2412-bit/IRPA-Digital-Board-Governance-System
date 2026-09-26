# IRPA-DGBS Live Meeting Infrastructure

## Purpose
This document defines the production architecture for the IRPA-owned live meeting service. It is separated from the Firebase governance datastore so the media layer can be deployed, tested, upgraded, or rolled back without disabling governance records or current administrators.

## Architecture
IRPA-DGBS remains the authoritative governance system: Firebase Authentication for identity; Firestore for meetings, participants, agenda, attendance, resolutions, voting, decisions, actions and audit records; the existing invitation workflow for controlled participant invitations; and the existing access-authority model for selected capacity. The live media layer supplies real-time audio/video/data only.

Recommended media engine: self-hosted LiveKit OSS. It supports self-hosted realtime audio/video/data, end-to-end encryption, webhooks, and separately deployed Egress for recording/streaming.

## Production topology
IRPA-DGBS -> Meeting Control API -> authorization and room/token lifecycle -> self-hosted LiveKit SFU/TURN -> WebRTC participants. Optional Egress handles authorized recording/streaming. Optional transcription/AI services support proceedings but never replace human approval.

## Ownership principle
IRPA should operate the self-hosted media infrastructure and control DNS, credentials, encryption configuration, recording storage, monitoring and deployment lifecycle. Never expose LiveKit API secrets to the browser.

## Required production components
1. Dedicated meeting host or cluster.
2. TLS certificate for the meeting endpoint.
3. WebRTC UDP media range.
4. WebRTC TCP fallback.
5. TURN/UDP and TURN/TLS.
6. Secure room/token gateway.
7. Redis where required by the selected distributed/Egress topology.
8. Monitoring and health checks.
9. Backup and recovery.
10. Optional Egress worker for recording.
11. Optional transcription worker/service.

## Initial deployment profile
Use a dedicated VM for the first controlled production pilot rather than Kubernetes. This reduces operational complexity while preserving a path to clustered deployment later. The final firewall policy must be reviewed against the selected LiveKit configuration.

Typical ports are 7880 API/WebSocket, 7881 WebRTC/TCP fallback, 3478/UDP TURN, 5349/TCP TURN/TLS when enabled, and 50000-60000/UDP for WebRTC media unless a configured UDP mux is used.

## Meeting-room security contract
1. Authenticated user opens an authorized IRPA meeting. 2. IRPA-DGBS verifies meeting status and participant authorization. 3. IRPA-DGBS verifies selected access authority where applicable. 4. A server-side meeting gateway issues a short-lived LiveKit participant token. 5. Browser connects using that token. 6. Join/leave and relevant room events reconcile into the IRPA meeting record. 7. Token issuance and privileged operations are auditable.

The browser must never receive LIVEKIT_API_SECRET.

## Governance boundary
Live media does not determine board membership, voting eligibility, quorum, resolution status, approval authority, minutes approval, or administrator authority. Those remain IRPA-DGBS governance decisions.

## Recording
Recording is disabled by default unless the meeting policy authorizes it. Start/stop must be auditable; metadata must bind to the meeting ID; storage must be access-controlled; retention must follow IRPA policy; recording must not silently become the authoritative minutes.

## Transcription and AI
Live transcription may support proceedings capture. AI may draft minutes or summaries, but the existing human review/approval workflow remains authoritative.

## Rollback
The media service must be independently disableable. If it fails, Firebase Authentication, Firestore governance records, current administrators and meeting records remain intact. The organization can temporarily use an alternative meeting channel without modifying governance data.

## Acceptance tests
Authenticated participant can join an authorized meeting; unauthorized participant cannot obtain a meeting token; expired/revoked authorization cannot obtain a new token; a token cannot access another meeting; camera/microphone work; screen sharing works; Android works; UDP works; TCP fallback works; TURN/TLS works from restrictive networks; closure prevents new joins; room events reconcile; recording requires authorization; recordings bind to the correct meeting; current administrators remain unaffected; Firebase production data remains untouched during media deployment; rollback works without modifying governance records.

## Security baseline
WebRTC media must use authenticated/encrypted transport. Do not deploy plain RTP/RTCP. TLS certificates, API secrets, TURN credentials and recording-storage credentials remain server-side.

## Current repository boundary
At repository commit 16c03442979d815f9454140b00c1b4f75d895b2c, IRPA-DGBS contains a substantial governance meeting workspace but no verified implementation of RTCPeerConnection/getUserMedia or a media SFU. This document therefore defines the missing production media layer without claiming it is already installed.

## Next deployment gate
Do not publish a live meeting endpoint until the infrastructure host is provisioned, DNS and TLS are valid, firewall rules are reviewed, LiveKit is deployed, the meeting-control gateway is deployed, short-lived token issuance is tested, mobile/restrictive-network tests pass, and security/rollback tests pass.