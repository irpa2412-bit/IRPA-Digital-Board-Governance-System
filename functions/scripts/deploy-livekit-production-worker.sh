#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

required=(
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID
  LIVEKIT_PRODUCTION_URL
  LIVEKIT_PRODUCTION_API_KEY
  LIVEKIT_PRODUCTION_API_SECRET
  LIVEKIT_PRODUCTION_RECORDING_BUCKET
  LIVEKIT_PRODUCTION_RECORDING_GCP_CREDENTIALS_JSON
  FIREBASE_SERVICE_ACCOUNT
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "::error::Missing required production LiveKit release secret: ${name}"
    exit 1
  fi
done

node <<'NODE'
const project = "irpa-digital-board-governance";
const account = JSON.parse(process.env.LIVEKIT_PRODUCTION_RECORDING_GCP_CREDENTIALS_JSON);
const firebase = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const endpoint = new URL(process.env.LIVEKIT_PRODUCTION_URL);
if (account.project_id !== project ||
    account.client_email !== "irpa-livekit-recorder@irpa-digital-board-governance.iam.gserviceaccount.com" ||
    !account.private_key) {
  console.error("Refusing recording key: use the dedicated recording service account in the production project.");
  process.exit(1);
}
if (firebase.project_id !== project) {
  console.error("Refusing production smoke test with a Firebase service account from another project.");
  process.exit(1);
}
if (endpoint.protocol !== "wss:" || /staging|localhost|127\.0\.0\.1/i.test(endpoint.hostname)) {
  console.error("Refusing production promotion: LIVEKIT_PRODUCTION_URL must be a production wss:// endpoint.");
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{8,64}$/.test(process.env.LIVEKIT_PRODUCTION_API_KEY) ||
    process.env.LIVEKIT_PRODUCTION_API_SECRET.length < 32) {
  console.error("LiveKit production API credentials are malformed or weak.");
  process.exit(1);
}
console.log("Production LiveKit endpoint and dedicated recording identity validated.");
NODE

curl --fail --silent --show-error \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Accept: application/json" \
  https://api.cloudflare.com/client/v4/user/tokens/verify > "$RUNNER_TEMP/cf-token.json"
node -e 'const x=require(process.argv[1]);if(!x.success)process.exit(1)' "$RUNNER_TEMP/cf-token.json"

npm --prefix functions install --omit=dev
LIVEKIT_URL="$LIVEKIT_PRODUCTION_URL" \
LIVEKIT_API_KEY="$LIVEKIT_PRODUCTION_API_KEY" \
LIVEKIT_API_SECRET="$LIVEKIT_PRODUCTION_API_SECRET" \
  node functions/scripts/verify-livekit-control-plane.js

node functions/scripts/verify-livekit-recording-storage.js
node --check cloudflare/livekit-production/worker.js

npx --yes wrangler deploy --config wrangler.livekit-production.jsonc
printf '%s' "$LIVEKIT_PRODUCTION_URL" | npx --yes wrangler secret put LIVEKIT_URL --config wrangler.livekit-production.jsonc
printf '%s' "$LIVEKIT_PRODUCTION_API_KEY" | npx --yes wrangler secret put LIVEKIT_API_KEY --config wrangler.livekit-production.jsonc
printf '%s' "$LIVEKIT_PRODUCTION_API_SECRET" | npx --yes wrangler secret put LIVEKIT_API_SECRET --config wrangler.livekit-production.jsonc
printf '%s' "$LIVEKIT_PRODUCTION_RECORDING_BUCKET" | npx --yes wrangler secret put LIVEKIT_RECORDING_BUCKET --config wrangler.livekit-production.jsonc
printf '%s' "$LIVEKIT_PRODUCTION_RECORDING_GCP_CREDENTIALS_JSON" | npx --yes wrangler secret put LIVEKIT_RECORDING_GCP_CREDENTIALS_JSON --config wrangler.livekit-production.jsonc

worker_url="https://irpa-dgb-livekit-production-token.irpa-governance.workers.dev"
health="$(curl --fail --silent --show-error --retry 8 --retry-all-errors --retry-delay 3 --max-time 30 "$worker_url/__irpa_health")"
echo "$health"
node -e 'const x=JSON.parse(process.argv[1]);if(!x.ok||!x.tokenConfigured||!x.recordingStorageConfigured)process.exit(1)' "$health"

LIVEKIT_WORKER_URL="$worker_url" node functions/scripts/verify-cloudflare-livekit-production-worker.js
echo "PASS: Production LiveKit worker deployed; token authorization, policy boundary, Firestore audit, and storage write/read/delete verified."
