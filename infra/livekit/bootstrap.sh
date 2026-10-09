#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root (sudo)." >&2
  exit 1
fi
ENV_FILE="${1:-}"
if [[ -z "${ENV_FILE}" || ! -f "${ENV_FILE}" ]]; then
  echo "Usage: sudo bash bootstrap.sh /path/to/.env" >&2
  exit 2
fi
set -a
# This file is created by the controlled deployment workflow and must contain
# only validated KEY=value entries, not arbitrary shell statements.
source "${ENV_FILE}"
set +a

: "${LIVEKIT_DOMAIN:?Set LIVEKIT_DOMAIN}"
: "${LIVEKIT_TURN_DOMAIN:?Set LIVEKIT_TURN_DOMAIN}"
: "${LIVEKIT_ACME_EMAIL:?Set LIVEKIT_ACME_EMAIL}"
: "${LIVEKIT_API_KEY:?Set LIVEKIT_API_KEY}"
: "${LIVEKIT_API_SECRET:?Set LIVEKIT_API_SECRET}"

[[ "${LIVEKIT_DOMAIN}" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "Invalid LIVEKIT_DOMAIN" >&2; exit 3; }
[[ "${LIVEKIT_TURN_DOMAIN}" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "Invalid LIVEKIT_TURN_DOMAIN" >&2; exit 3; }
[[ "${LIVEKIT_API_KEY}" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "Invalid LIVEKIT_API_KEY format" >&2; exit 3; }
[[ "${LIVEKIT_API_SECRET}" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "Invalid LIVEKIT_API_SECRET format" >&2; exit 3; }

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2 certbot gettext-base curl
systemctl enable --now docker

INSTALL_DIR=/opt/irpa-livekit
mkdir -p "${INSTALL_DIR}"
cp "$(dirname "$0")/docker-compose.yml" "${INSTALL_DIR}/docker-compose.yml"
cp "$(dirname "$0")/Caddyfile" "${INSTALL_DIR}/Caddyfile"
cp "$(dirname "$0")/livekit.yaml.template" "${INSTALL_DIR}/livekit.yaml.template"
install -m 600 "${ENV_FILE}" "${INSTALL_DIR}/.env"

# DNS for both names must already resolve to this host. Certbot standalone
# owns port 80 only during initial issuance; Caddy starts after this step.
if [[ ! -s /etc/letsencrypt/live/irpa-livekit/fullchain.pem ]]; then
  certbot certonly --standalone --non-interactive --agree-tos \
    --email "${LIVEKIT_ACME_EMAIL}" --cert-name irpa-livekit \
    -d "${LIVEKIT_DOMAIN}" -d "${LIVEKIT_TURN_DOMAIN}"
fi

cd "${INSTALL_DIR}"
envsubst '${LIVEKIT_API_KEY} ${LIVEKIT_API_SECRET} ${LIVEKIT_TURN_DOMAIN}' \
  < livekit.yaml.template > livekit.yaml
chmod 600 livekit.yaml
docker compose --env-file .env config >/dev/null
docker compose --env-file .env pull
docker compose --env-file .env up -d

cat >/usr/local/sbin/irpa-livekit-renew-certs <<'RENEW'
#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/irpa-livekit
docker compose --env-file .env stop caddy
restart_caddy() { docker compose --env-file .env start caddy >/dev/null 2>&1 || true; }
trap restart_caddy EXIT
certbot renew --quiet
docker compose --env-file .env start caddy
docker compose --env-file .env restart livekit
trap - EXIT
RENEW
chmod 700 /usr/local/sbin/irpa-livekit-renew-certs
cat >/etc/systemd/system/irpa-livekit-renew.service <<'UNIT'
[Unit]
Description=Renew IRPA LiveKit TLS certificates
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/irpa-livekit-renew-certs
UNIT
cat >/etc/systemd/system/irpa-livekit-renew.timer <<'UNIT'
[Unit]
Description=Daily check for IRPA LiveKit TLS certificate renewal
[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now irpa-livekit-renew.timer

cat >/etc/systemd/system/irpa-livekit.service <<'UNIT'
[Unit]
Description=IRPA LiveKit media stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/irpa-livekit
ExecStart=/usr/bin/docker compose --env-file .env up -d
ExecStop=/usr/bin/docker compose --env-file .env down
TimeoutStartSec=0
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable irpa-livekit.service

# Verify service state and TLS endpoint without printing credentials.
docker compose --env-file .env ps
for attempt in $(seq 1 20); do
  code="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 5 "https://${LIVEKIT_DOMAIN}/" || true)"
  if [[ "${code}" =~ ^[234][0-9][0-9]$ ]]; then
    echo "HTTPS endpoint answered with HTTP ${code}."
    exit 0
  fi
  sleep 3
done
echo "LiveKit HTTPS endpoint did not become reachable; inspect: cd /opt/irpa-livekit && docker compose logs" >&2
exit 4
