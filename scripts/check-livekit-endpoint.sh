#!/usr/bin/env bash
set -Eeuo pipefail

MEET_HOST="${MEET_HOST:-meet.irpa.or.tz}"
TURN_HOST="${TURN_HOST:-turn.irpa.or.tz}"
TURN_TLS_PORT="${TURN_TLS_PORT:-443}"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$*"; }

for cmd in getent curl openssl timeout; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: $cmd"
done

printf 'IRPA LiveKit endpoint preflight (no credentials are requested or printed)\n'
printf 'Meeting endpoint: %s\nTURN endpoint: %s:%s\n\n' "$MEET_HOST" "$TURN_HOST" "$TURN_TLS_PORT"

getent ahosts "$MEET_HOST" >/dev/null 2>&1 || fail "$MEET_HOST does not resolve on this host"
getent ahosts "$TURN_HOST" >/dev/null 2>&1 || fail "$TURN_HOST does not resolve on this host"
pass "Both DNS names resolve"

http_code="$(curl --connect-timeout 8 --max-time 15 --silent --show-error --output /dev/null --write-out '%{http_code}' "https://$MEET_HOST/" 2>/dev/null)" || fail "HTTPS/TLS request to https://$MEET_HOST/ failed"
[[ "$http_code" =~ ^2[0-9][0-9]$ ]] || fail "Meeting endpoint returned HTTP $http_code (expected 2xx health response)"
pass "HTTPS/TLS endpoint responds with HTTP $http_code"

timeout 8 openssl s_client -connect "$TURN_HOST:$TURN_TLS_PORT" -servername "$TURN_HOST" -verify_return_error -brief </dev/null >/dev/null 2>&1 || fail "TURN hostname TCP/TLS handshake or certificate verification failed on port $TURN_TLS_PORT"
pass "TURN hostname accepts a verified TLS handshake on port $TURN_TLS_PORT"

cat <<'EOF'

LIMITATION:
This preflight does not prove TURN allocation, token validity, UDP reachability,
TCP fallback, camera/microphone permission, media publication/subscription, or
HD video. Those require a valid staging token and the two-browser acceptance test.
EOF
