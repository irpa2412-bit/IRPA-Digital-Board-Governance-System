# IRPA-DBGS Meeting Portal: Cloudflare Worker Migration

## Scope

The existing `irpa-google-drive-gateway` Worker is the server-side meeting operations gateway. Firebase Authentication remains the identity provider and Firestore remains the authoritative governance data store. This migration does not replace Firestore or the browser's realtime listeners.

### Worker routes

- Meeting access: `POST /api/meeting-access/issue`, `/api/meeting-access/revoke`, `/api/meeting-access/authorize`
- Meeting register: `POST /api/meeting-register/create`, `/api/meeting-register/update`, `/api/meeting-register/delete`
- Meeting voting control: `POST /api/meeting-voting/open`, `/api/meeting-voting/close`
- Meeting-linked decisions: `POST /api/meeting-decisions/create`
- Scoped activity and subscription reads: `POST /api/meeting-room/activity`, `POST /api/meeting-subscriptions/mine`
- Record lifecycle: `POST /api/meeting-records/capture`, `/draft`, `/list`, `/retrieve`, `/protection`, `/dispose`
- Live proceedings and translation: `POST /api/meeting-proceedings/save`, `/api/meeting-transcripts/translate`
- Reports: `POST /api/meeting-reports/compile-email`
- Live media and recording: `POST /api/meeting-media/token`, `/recording/start`, `/recording/stop`, `/recording/status`

All routes require a verified Firebase ID token. The Worker performs server-side meeting/participant checks and records audit events. Final record deletion remains blocked by legal holds, retention windows and the required review state.

## Operations that remain on Firebase client SDK

These operations do not inherently depend on callable Cloud Functions and can remain client-side only while the Firestore rules remain enforced and tested:

- Meeting/participant realtime listeners and authorized meeting-register reads.
- Attendance check-in and controller attendance updates, constrained to the allowed attendance fields.
- Casting an anonymous vote: the client transaction writes the per-issue participant marker and vote together; rules reject a second marker, a closed issue, mismatched meeting/issue references, and voter identity fields in the vote record. Vote outcomes are only returned by the Worker after the linked issue is closed.
- Meeting-room event writes and action creation where existing governance-role rules allow them. Event history, vote tally reads, and the current user’s subscription list use scoped Worker queries to avoid downloading other meetings’ records into the browser.

Meeting-register writes, voting issue open/close, meeting-linked decision creation, record lifecycle, transcript persistence/translation, report dispatch and LiveKit controls are routed through the Worker because the previous direct client or callable path was either restricted by Firestore rules or depended on server-side secrets/privileged execution.

## Required Cloudflare configuration

Set secrets separately for production and staging; never commit secret values:

- `LIVEKIT_URL` — the configured secure LiveKit websocket endpoint.
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_EGRESS_R2_ENDPOINT` — Cloudflare R2 HTTPS S3 endpoint.
- `LIVEKIT_EGRESS_R2_BUCKET` — private recording bucket.
- `LIVEKIT_EGRESS_R2_ACCESS_KEY_ID` and `LIVEKIT_EGRESS_R2_SECRET_ACCESS_KEY` — bucket-scoped Object Read & Write credentials.
- `LIVEKIT_EGRESS_R2_REGION` — `auto`.

Room-composite recording also requires the pinned self-hosted LiveKit Egress service; the server/Redis/Caddy stack alone is insufficient. The Worker supplies the private R2 S3 output configuration to Egress per recording request. LiveKit API credentials remain on the media host as required by LiveKit, and must match the Worker secrets. R2 credentials are persisted as Cloudflare Worker secrets and passed per recording request over HTTPS to LiveKit Egress; they are not written to the VM configuration, source control, logs, or client.

The protected manual workflow `.github/workflows/cloudflare-livekit-secrets.yml` binds production Worker secrets from the GitHub `production` Environment. It requires R2 to be enabled/purchased, the private bucket to exist, and a bucket-scoped R2 token to be configured first. Do not provision or deploy until the previously identified account prerequisites and spending approval are resolved.

The existing Firebase callable definitions are retained temporarily for rollback, but the migrated frontend uses the Worker routes. Do not remove the legacy callable functions or revoke their Firebase secret versions until the Cloudflare Worker and private R2 recording upload have passed isolated end-to-end acceptance. This migration configures new recordings for R2; it does not copy, delete, or change access to any existing recording objects.

Transcript translation uses Google Cloud Translation through the existing server-side Google access token. Confirm the Translation API is enabled, billing is active if required, and the Worker service identity has the necessary Google Cloud Translation permissions.

Keep the existing mail route unchanged: Worker → `mail.irpa.or.tz:465`, sender `info@irpa.or.tz`. Report email delivery must be verified with a controlled recipient before any live success claim.

## Release verification

1. Run `npm test` in `drive-gateway` and the repository's frontend build/security/readability gates.
2. Test with a non-confidential test meeting and test participants first.
3. Verify create/update meeting, issue/revoke/authorize pass, attendance/quorum, open/close vote, duplicate vote rejection, decision creation, transcript auto-save, record hash verification, retention/legal hold, report dispatch, and LiveKit token/recording status.
4. Confirm unauthorized roles cannot read or modify records outside their meeting.
5. Verify SMTP delivery and the invitee tally against the attendance register.
6. Deploy only through the approved Worker workflow after required checks pass. This source migration by itself does not prove the production Worker has been deployed or that LiveKit/translation/mail credentials are configured.
