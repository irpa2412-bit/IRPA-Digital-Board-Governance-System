# IRPA DBGS Meta OAuth — staging acceptance

Scope: Facebook Page and linked Instagram professional-account connection and API-access verification only. Social posting, scheduling, messaging, advertising and insights are not implemented.

The integration is available only through the existing staging Cloudflare gateway. It rejects requests unless the Worker is explicitly in staging, uses Firebase project `irpa-dbg-staging-a73ec`, has production cutover disabled, and receives the callback on the exact staging gateway host.

Requested permissions are limited to `pages_show_list`, `pages_read_engagement`, and `instagram_basic`. The callback checks that all required read-only permissions were granted, then verifies the Meta user, Page list and eligible linked Instagram professional accounts.

## Configure staging only

Worker variables:
- `META_APP_ID`: IRPA-approved Meta developer app ID.
- `META_GRAPH_API_VERSION`: pinned in staging Wrangler configuration to `v26.0` (released July 29, 2026); verify the version remains supported before future upgrades.
- `META_REDIRECT_URI`: `https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev/api/communications/meta/callback` (also pinned in staging Wrangler configuration).

Cloudflare Worker secrets (staging environment only):
- `META_APP_SECRET`
- `META_TOKEN_ENCRYPTION_KEY`: random 32-byte key encoded as Base64; keep it separate from the Meta app secret.

For the repository's staging deployment workflow, configure the GitHub Actions repository secrets `STAGING_META_APP_ID`, `STAGING_META_APP_SECRET`, and `STAGING_META_TOKEN_ENCRYPTION_KEY`. The workflow injects the App ID as a staging Worker variable and provisions the latter two as Worker secrets without printing them. If all three are absent, the Worker deploys with Meta integration disabled; a partial set fails the Meta-secret step. Alternatively, configure the equivalent variables/secrets directly in the staging Worker environment. Do not place values in source control, chat, browser storage, Firestore or logs. Do not copy production values into staging.

The gateway uses the existing `DRIVE_KV` binding for a one-use OAuth state with a 10-minute TTL and an AES-256-GCM-encrypted connection record. Tokens are never returned to the browser or saved in Firestore. The status endpoint re-checks granted scopes and API access. Local disconnect removes the encrypted staging record but does not revoke the app inside Meta.

## Required live acceptance

1. Verify the staging app is registered in Meta and add the exact callback URI to Valid OAuth Redirect URIs.
2. Ensure Facebook Login is enabled and the authorized test account/Page is controlled by IRPA.
3. Configure the staging-only variables and secrets above.
4. Run `npm run test:meta-oauth`, Worker syntax checks, existing portal tests, the web build and gateway regression suite.
5. Complete a real staging OAuth flow; confirm Facebook Pages and eligible linked Instagram accounts are returned without tokens.
6. Confirm the production host/project are rejected and no posting endpoint or publishing permission exists.

Do not proceed to production or enable social posting under this task. If Meta review, business verification or advanced access is required, treat it as a blocker rather than broadening the permission set.
