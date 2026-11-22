#!/usr/bin/env python3
"""Execute the LiveKit staging installer with values from a JSON file, without shell-sourcing secrets."""
import json
import os
import pathlib
import subprocess
import sys

if len(sys.argv) != 3:
    raise SystemExit("usage: run-deploy-with-env.py ENV_JSON DEPLOY_SCRIPT")
env_path = pathlib.Path(sys.argv[1])
script_path = pathlib.Path(sys.argv[2])
try:
    values = json.loads(env_path.read_text(encoding="utf-8"))
    allowed = {"LIVEKIT_DOMAIN", "LIVEKIT_TURN_DOMAIN", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "ACME_EMAIL"}
    if set(values) != allowed or any(not isinstance(v, str) or not v for v in values.values()):
        raise ValueError("environment file fields are missing or invalid")
    env = os.environ.copy()
    env.update(values)
    result = subprocess.run(["bash", str(script_path)], env=env, check=False)
    raise SystemExit(result.returncode)
finally:
    try:
        env_path.unlink()
    except FileNotFoundError:
        pass
