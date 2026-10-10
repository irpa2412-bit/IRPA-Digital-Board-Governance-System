# Cloudflare production migration: Grant Crawler

This Worker replaces the grant crawler's Firebase Cloud Functions execution path while preserving Firestore as the grant-record store.

## Deploy prerequisites
1. Create/verify a Cloudflare Worker named `irpa-dbgs-grant-crawler`.
2. Add Worker secret `FIREBASE_SERVICE_ACCOUNT_JSON`: the JSON service-account key for a dedicated service account scoped to the target Firebase project. Grant only the Firestore permissions required to read/write grant crawler collections; do not reuse a broad owner credential.
3. Set the Cloudflare Worker route/origin and restrict access to the Worker endpoint as appropriate for the production domain.
4. Add GitHub Actions secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_FIREBASE_SERVICE_ACCOUNT_JSON` (dedicated least-privilege Firestore service account) if CI deployment is enabled.
5. Deploy with Wrangler and verify a scheduled run and an administrator-initiated run before disabling Firebase functions.

## Runtime
- Cron: `0 */6 * * *` (UTC; Tanzania is UTC+3).
- Manual endpoint: `POST /run` with a Firebase ID token in `Authorization: Bearer <id-token>`.
- Public source discovery only. All discovered records remain pending verification.
- Firestore collections: `grantOpportunities`, `grantCrawlerStatus`, `grantCrawlerSources`, `grantCrawlerRuns`.

## Security and rollout
Never commit service-account JSON, private keys, or Cloudflare tokens. Use Worker Secrets. Confirm service-account IAM is least-privilege and rotate any credential exposed in logs. The Worker must be tested against a non-production Firestore project before production cutover.

## Important compatibility note
The manual endpoint authorizes from Firebase custom claims, matching the prior callable's claim-based check. Verify that the approved IRPA grant-management roles are actually present as custom claims before production rollout. Do not remove the Firebase functions until portal integration and scheduled/manual execution are verified.
