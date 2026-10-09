#!/usr/bin/env bash
set -Eeuo pipefail
fail=0
for cmd in docker getent curl envsubst; do
  if command -v "$cmd" >/dev/null 2>&1; then printf 'PASS command available: %s\n' "$cmd"; else printf 'FAIL command missing: %s\n' "$cmd"; fail=1; fi
done
if [[ -z "${LIVEKIT_DOMAIN:-}" || -z "${LIVEKIT_TURN_DOMAIN:-}" ]]; then
  echo "FAIL set LIVEKIT_DOMAIN and LIVEKIT_TURN_DOMAIN before running DNS checks"; exit 2
fi
for domain in "$LIVEKIT_DOMAIN" "$LIVEKIT_TURN_DOMAIN"; do
  if getent ahostsv4 "$domain" >/dev/null 2>&1; then
    printf 'PASS DNS resolves: %s -> %s\n' "$domain" "$(getent ahostsv4 "$domain" | awk 'NR==1{print $1}')"
  else
    printf 'FAIL DNS does not resolve: %s\n' "$domain"; fail=1
  fi
done
if [[ "$fail" -ne 0 ]]; then exit 1; fi
echo "PASS basic host and DNS preflight. This does not test firewall reachability, TLS issuance, API credentials, or WebRTC media."
