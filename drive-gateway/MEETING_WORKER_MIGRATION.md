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

- `LIVEKIT_URL` — the configured LiveKit websocket endpoint.
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

The LiveKit Egress service and its file-output storage must be configured for the existing recording output path. The Worker must fail closed if LiveKit credentials are missing or recording is not enabled on the authoritative meeting record.

Transcript translation uses Google Cloud Translation through the existing server-side Google access token. Confirm the Translation API is enabled, billing is active if required, and the Worker service identity has the necessary Google Cloud Translation permissions.

Keep the existing mail route unchanged: Worker → `mail.irpa.or.tz:465`, sender `info@irpa.or.tz`. Report email delivery must be verified with a controlled recipient before any live success claim.

## Release verification

1. Run `npm test` in `drive-gateway` and the repository's frontend build/security/readability gates.
2. Test with a non-confidential test meeting and test participants first.
3. Verify create/update meeting, issue/revoke/authorize pass, attendance/quorum, open/close vote, duplicate vote rejection, decision creation, transcript auto-save, record hash verification, retention/legal hold, report dispatch, and LiveKit token/recording status.
4. Confirm unauthorized roles cannot read or modify records outside their meeting.
5. Verify SMTP delivery and the invitee tally against the attendance register.
6. Deploy only through the approved Worker workflow after required checks pass. This source migration by itself does not prove the production Worker has been deployed or that LiveKit/translation/mail credentials are configured.
