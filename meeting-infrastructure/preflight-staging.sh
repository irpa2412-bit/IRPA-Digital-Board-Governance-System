#!/usr/bin/env bash
set -euo pipefail

fail(){ printf 'FAIL: %s\n' "$*" >&2; exit 1; }
need(){ local n="$1"; [[ -n "${!n:-}" ]] || fail "missing required setting: $n"; }

need STAGING_FIREBASE_PROJECT_ID
need STAGING_APP_URL
need LIVEKIT_URL
need LIVEKIT_API_KEY
need LIVEKIT_API_SECRET
need MEETING_HOST_EMAIL
need MEETING_INVITEE_EMAIL

[[ "$STAGING_FIREBASE_PROJECT_ID" != "irpa-digital-board-governance" ]] || fail "refusing to treat the production Firebase project as staging"
[[ "${MEETING_HOST_EMAIL,,}" != "${MEETING_INVITEE_EMAIL,,}" ]] || fail "host and invitee must be different identities"
[[ "$STAGING_APP_URL" == https://* ]] || fail "staging app URL must use HTTPS"
[[ "$LIVEKIT_URL" == wss://* ]] || fail "LiveKit browser URL must use WSS/TLS"

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v node >/dev/null 2>&1 || fail "Node.js is required"

printf 'CHECK: staging web app HTTPS endpoint\n'
status="$(curl --silent --show-error --location --max-time 15 --output /dev/null --write-out '%{http_code}' "$STAGING_APP_URL")" || fail "staging app TLS/HTTP request failed"
[[ "$status" =~ ^2[0-9][0-9]$ ]] || fail "staging app returned HTTP $status, expected 2xx"
printf 'PASS: staging app returned HTTP %s over HTTPS\n' "$status"

printf 'CHECK: authenticated LiveKit API connectivity\n'
(cd "$(dirname "$0")/../functions" && npm run check:livekit-connectivity)

if command -v firebase >/dev/null 2>&1; then
  printf 'CHECK: deployed Functions list (operator must be authenticated to the staging project)\n'
  functions="$(firebase functions:list --project "$STAGING_FIREBASE_PROJECT_ID" 2>/dev/null)" || fail "Firebase CLI could not list Functions for staging; check operator authentication and project access"
  for fn in authorizeMeetingEntry createMeetingAccessInvitation revokeMeetingAccessInvitation issueLiveMeetingToken; do
    grep -q "$fn" <<<"$functions" || fail "Function $fn is not visible in staging project $STAGING_FIREBASE_PROJECT_ID"
    printf 'PASS: Function %s is listed\n' "$fn"
  done
else
  printf 'WARN: Firebase CLI not installed; deployed Functions presence was not checked\n'
fi

printf '\nPASS: infrastructure preflight passed. This does NOT replace the two-browser audio/video test.\n'
printf 'NEXT: send a real invitation, open separate host/invitee browser profiles, and verify two-way audio/video and reconnect behavior.\n'
