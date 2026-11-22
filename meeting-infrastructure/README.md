# Legacy LiveKit notes — not a deployment configuration

The former examples in this directory have been retired to prevent conflicting LiveKit configurations.

**Canonical staging implementation:** [infra/livekit/README.md](../infra/livekit/README.md)

Do not deploy from this directory. It intentionally contains no Compose file, LiveKit server config, or deployment workflow. The canonical deployment is staging-only, requires the protected `livekit-staging` environment, and must not be used until the DigitalOcean account, billing, SSH, DNS, firewall and staging Firebase prerequisites are verified. Production DNS, production Firebase, and production governance data must remain untouched.
