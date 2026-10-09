#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${LIVEKIT_DOMAIN:?Set LIVEKIT_DOMAIN to the meeting WebSocket hostname}"
: "${LIVEKIT_TURN_DOMAIN:?Set LIVEKIT_TURN_DOMAIN to the TURN/TLS hostname}"
: "${LIVEKIT_API_KEY:?Set LIVEKIT_API_KEY in the protected deployment environment}"
: "${LIVEKIT_API_SECRET:?Set LIVEKIT_API_SECRET in the protected deployment environment}"
: "${ACME_EMAIL:?Set ACME_EMAIL for automatic TLS certificate notices}"

valid_domain='^[A-Za-z0-9.-]+$'
if [[ ! "$LIVEKIT_DOMAIN" =~ $valid_domain || ! "$LIVEKIT_TURN_DOMAIN" =~ $valid_domain ]]; then
  echo "Refusing invalid DNS hostname." >&2; exit 2
fi
if [[ "$LIVEKIT_DOMAIN" == "$LIVEKIT_TURN_DOMAIN" ]]; then
  echo "The meeting and TURN hostnames must be different." >&2; exit 2
fi
if [[ ! "$LIVEKIT_API_KEY" =~ ^[A-Za-z0-9_-]{8,64}$ || ! "$LIVEKIT_API_SECRET" =~ ^[A-Za-z0-9_-]{32,128}$ || "$LIVEKIT_API_KEY" == "devkey" || "$LIVEKIT_API_SECRET" == "secret" ]]; then
  echo "Refusing default, weak, or unsupported LiveKit credentials." >&2; exit 2
fi
if [[ $EUID -ne 0 ]]; then echo "Run this script as root (sudo)." >&2; exit 2; fi

# Fail closed unless both DNS names already point to this VM. Do not create or
# modify public DNS records automatically.
for domain in "$LIVEKIT_DOMAIN" "$LIVEKIT_TURN_DOMAIN"; do
  if ! getent ahostsv4 "$domain" >/dev/null 2>&1; then
    echo "DNS does not resolve for $domain; configure its A record before deployment." >&2; exit 3
  fi
done
public_ip="$(curl -4fsS --max-time 8 https://api.ipify.org || true)"
if [[ -z "$public_ip" ]]; then
  echo "Could not determine this VM's public IPv4 address; refusing certificate/deployment step." >&2; exit 3
fi
for domain in "$LIVEKIT_DOMAIN" "$LIVEKIT_TURN_DOMAIN"; do
  if ! getent ahostsv4 "$domain" | awk '{print $1}' | grep -Fxq "$public_ip"; then
    echo "DNS for $domain does not include this VM's public IPv4 address." >&2; exit 3
  fi
done

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2 gettext-base curl ca-certificates
systemctl enable --now docker

install -d -o root -g root -m 0700 /opt/irpa-livekit
cd /opt/irpa-livekit
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install -m 0640 "$script_dir/docker-compose.yml" ./docker-compose.yml
install -m 0640 "$script_dir/caddy.yaml.template" ./caddy.yaml.template
install -m 0640 "$script_dir/livekit.yaml.template" ./livekit.yaml.template

# Keep secrets root-only; never echo them or commit generated config.
cat > .env <<EOF
LIVEKIT_DOMAIN=$LIVEKIT_DOMAIN
LIVEKIT_TURN_DOMAIN=$LIVEKIT_TURN_DOMAIN
LIVEKIT_API_KEY=$LIVEKIT_API_KEY
LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET
ACME_EMAIL=$ACME_EMAIL
EOF
chmod 0600 .env
envsubst '${LIVEKIT_DOMAIN} ${LIVEKIT_TURN_DOMAIN}' < caddy.yaml.template > caddy.yaml
envsubst '${LIVEKIT_API_KEY} ${LIVEKIT_API_SECRET} ${LIVEKIT_TURN_DOMAIN}' < livekit.yaml.template > livekit.yaml
chmod 0600 caddy.yaml livekit.yaml

docker compose -f docker-compose.yml config -q
docker compose -f docker-compose.yml pull
docker compose -f docker-compose.yml up -d

cat > /etc/systemd/system/irpa-livekit.service <<'UNIT'
[Unit]
Description=IRPA isolated LiveKit staging media stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/irpa-livekit
ExecStart=/usr/bin/docker compose -f /opt/irpa-livekit/docker-compose.yml up -d
ExecStop=/usr/bin/docker compose -f /opt/irpa-livekit/docker-compose.yml down
TimeoutStartSec=0
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable irpa-livekit.service

# Caddy's official LiveKit L4 build multiplexes TLS on TCP/443 by SNI:
# meeting WSS -> 7880; TURN/TLS -> the internal LiveKit TURN listener 5349.
# TURN/TLS certificates are automatically issued and renewed by Caddy.
for attempt in $(seq 1 30); do
  code="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 5 "https://$LIVEKIT_DOMAIN/" || true)"
  if [[ "$code" =~ ^(2[0-9][0-9]|3[0-9][0-9]|404)$ ]]; then
    echo "Meeting HTTPS/WSS endpoint reachable (HTTP $code)."
    docker compose -f docker-compose.yml ps
    echo "Endpoint reachability is not proof of authenticated API access or WebRTC media; run the separate staging acceptance tests."
    exit 0
  fi
  sleep 3
done

echo "LiveKit HTTPS endpoint did not become reachable; inspect container logs on the staging VM." >&2
docker compose -f docker-compose.yml ps >&2 || true
exit 4
