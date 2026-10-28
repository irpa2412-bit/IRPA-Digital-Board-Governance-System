# IRPA staging website maintenance adapter contract

The scheduled maintenance engine is deliberately fail-closed. It does not install a WordPress plugin, change cPanel credentials, or touch production. It can mutate staging only after both GitHub Actions secrets are configured:

- `STAGING_MAINTENANCE_API_URL`: exactly `https://staging.irpa.or.tz/wp-json/irpa-maintenance/v1`
- `STAGING_MAINTENANCE_API_TOKEN`: a dedicated, rotatable token for a restricted staging-only host adapter

**The host adapter must be installed and security-reviewed separately before automatic repairs can actually execute.** Until then the engine reports maintenance as disabled. Do not point this endpoint or token at production.

## Required authenticated adapter operations

All responses must be JSON. All mutating calls must be idempotent where possible, audit-logged, limited to staging, and reject content, publishing, users, arbitrary commands, and arbitrary filesystem paths.

- `GET /health` -> `{ "environment":"staging", "siteHost":"staging.irpa.or.tz", "healthy":true, "faults":[], "allowedRestartServices":[] }`
- `GET /backups/latest` -> `{ "id":"...", "restorable":true, "createdAt":"ISO-8601" }`; only backups verified restorable and less than 24 hours old qualify.
- `POST /repairs` -> accept only `cache.clear` or an explicitly allowlisted service restart.
- `POST /updates/plan` -> compatibility/dry-run result for exact pinned WordPress core, plugin or theme versions.
- `POST /updates/apply` -> apply only the supplied versions from the reviewed manifest, never arbitrary package names/versions.
- `POST /rollback` -> restore the backup identified by the request and verify the site is healthy.

The engine performs post-repair health checks, attempts rollback after failed updates, and reports when human intervention is required. A successful rollback is not assumed unless both the adapter response and health check confirm it.

## Update approvals

The checked-in `maintenance/approved-updates.staging.json` starts with an empty update list. Add only exact versions after a human has reviewed the staging compatibility report. Floating tags such as `latest`, version ranges and wildcards are rejected.

The engine never exposes an endpoint for page/post editing or publishing. Existing Communications Portal approval remains the only content-publication path.
