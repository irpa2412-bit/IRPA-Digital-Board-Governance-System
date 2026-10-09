#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${LIVEKIT_DOMAIN:?Set LIVEKIT_DOMAIN to the DNS name for the LiveKit WebSocket endpoint}"
: "${LIVEKIT_TURN_DOMAIN:?Set LIVEKIT_TURN_DOMAIN to the DNS name for TURN/TLS}"
: "${LIVEKIT_API_KEY:?Set LIVEKIT_API_KEY in the deployment environment}"
: "${LIVEKIT_API_SECRET:?Set LIVEKIT_API_SECRET in the deployment environment}"
: "${ACME_EMAIL:?Set ACME_EMAIL for TLS certificate expiry notices}"

if [[ ! "$LIVEKIT_DOMAIN" =~ ^[a-zA-Z0-9.-]+$ || ! "$LIVEKIT_TURN_DOMAIN" =~ ^[a-zA-Z0-9.-]+$ ]]; then
  echo "Domain names contain unsupported characters." >&2; exit 2
fi
if [[ "$LIVEKIT_DOMAIN" == "$LIVEKIT_TURN_DOMAIN" ]]; then
  echo "Use separate DNS names for the WebSocket endpoint and TURN/TLS." >&2; exit 2
fi
if [[ "$LIVEKIT_API_KEY" == "devkey" || "$LIVEKIT_API_SECRET" == "secret" || ${#LIVEKIT_API_SECRET} -lt 32 ]]; then
  echo "Refusing default/weak LiveKit credentials; use a unique key and at least 32-character secret." >&2; exit 2
fi
if [[ $EUID -ne 0 ]]; then echo "Run this script as root (sudo)." >&2; exit 2; fi
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 certbot
fi
systemctl enable --now docker
apt-get install -y certbot
install -d -m 0750 /opt/irpa-livekit /var/www/certbot
cd /opt/irpa-livekit

cat > Caddyfile <<EOF
{
  email $ACME_EMAIL
}
$LIVEKIT_DOMAIN {
  reverse_proxy 127.0.0.1:7880
}
http://$LIVEKIT_TURN_DOMAIN {
  handle /.well-known/acme-challenge/* {
    root * /var/www/certbot
    file_server
  }
  respond "IRPA TURN/TLS certificate endpoint" 404
}
EOF

cat > compose.yaml <<'EOF'
services:
  caddy:
    image: caddy:2.10.2
    container_name: irpa-livekit-caddy
    network_mode: host
    restart: unless-stopped
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
      - /var/www/certbot:/var/www/certbot:ro
  livekit:
    image: livekit/livekit-server:v1.13.7
    container_name: irpa-livekit-server
    network_mode: host
    restart: unless-stopped
    command: ["--config", "/etc/livekit.yaml"]
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
volumes:
  caddy_data:
  caddy_config:
EOF

docker compose up -d caddy
# Caddy serves the HTTP-01 challenge directory for the TURN host; the primary
# endpoint's certificate is obtained automatically by Caddy.
certbot certonly --webroot -w /var/www/certbot \
  --cert-name "$LIVEKIT_TURN_DOMAIN" -d "$LIVEKIT_TURN_DOMAIN" \
  --email "$ACME_EMAIL" --agree-tos --non-interactive

cat > livekit.yaml <<EOF
port: 7880
log_level: info
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
keys:
  "$LIVEKIT_API_KEY": "$LIVEKIT_API_SECRET"
turn:
  enabled: true
  domain: "$LIVEKIT_TURN_DOMAIN"
  tls_port: 5349
  udp_port: 3478
  cert_file: "/etc/letsencrypt/live/$LIVEKIT_TURN_DOMAIN/fullchain.pem"
  key_file: "/etc/letsencrypt/live/$LIVEKIT_TURN_DOMAIN/privkey.pem"
EOF
chmod 0600 livekit.yaml
chmod 0640 Caddyfile compose.yaml
docker compose up -d livekit
# Renew TURN TLS certificates automatically and restart LiveKit after renewal.
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/irpa-livekit-restart.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/irpa-livekit
docker compose restart livekit
EOF
chmod 0750 /etc/letsencrypt/renewal-hooks/deploy/irpa-livekit-restart.sh
systemctl enable --now certbot.timer || true

cat > /opt/irpa-livekit/endpoint.txt <<EOF
wss://$LIVEKIT_DOMAIN
turns:$LIVEKIT_TURN_DOMAIN:5349?transport=tcp
EOF
chmod 0640 /opt/irpa-livekit/endpoint.txt

echo "LiveKit containers are started. This is not yet acceptance proof."
echo "Verify DNS, TLS, firewall rules, authenticated API calls and a two-browser WebRTC session."
echo "Endpoint: wss://$LIVEKIT_DOMAIN"
