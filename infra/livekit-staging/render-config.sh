#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example to .env and set unique random secrets." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a
: "${LIVEKIT_API_KEY:?LIVEKIT_API_KEY is required}"
: "${LIVEKIT_API_SECRET:?LIVEKIT_API_SECRET is required}"
if [[ "${LIVEKIT_API_KEY}" == "replace-with-random-API-key" || "${LIVEKIT_API_SECRET}" == "replace-with-at-least-32-random-bytes" ]]; then
  echo "Refusing to render a configuration with example credentials." >&2
  exit 1
fi
if [[ "${#LIVEKIT_API_SECRET}" -lt 32 ]]; then
  echo "LIVEKIT_API_SECRET must contain at least 32 characters." >&2
  exit 1
fi
mkdir -p runtime
python3 - <<'PY'
import os
from pathlib import Path
template = Path("livekit.yaml.tmpl").read_text()
for key in ("LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"):
    template = template.replace("${" + key + "}", os.environ[key])
Path("runtime/livekit.yaml").write_text(template)
Path("runtime/livekit.yaml").chmod(0o600)
PY
echo "Rendered runtime/livekit.yaml (secret file is local and gitignored)."
