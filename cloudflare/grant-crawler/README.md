# IRPA Grant Crawler

An isolated Cloudflare Worker for collecting public funding-call metadata from approved RSS/Atom feeds. Initial staging storage is a dedicated D1 database. Firebase synchronization is intentionally off until collection-specific least-privilege rules and a dedicated identity are reviewed and tested.

## Local checks

    cd cloudflare/grant-crawler
    npm run check

## Staging prerequisites
Configure GitHub Actions secrets CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and GRANT_CRAWLER_CONTROL_TOKEN (at least 32 characters). Optionally set GRANT_CRAWLER_FEED_URLS to a JSON array of official HTTPS RSS/Atom feed URLs. The Cloudflare token should be restricted to the account and only the Workers Scripts and D1 actions needed for this staging Worker/database.

Run the IRPA Grant Crawler — Isolated Staging workflow manually after its pull request has been reviewed. It deploys only irpa-grant-crawler-staging; it does not touch irpa-google-drive-gateway or deploy Firebase.

## Endpoints
- GET /health: returns service/environment/storage status, without secrets.
- POST /crawl: requires Authorization: Bearer <CRAWLER_CONTROL_TOKEN>.
- Scheduled scan: every six hours in the staging environment; with no feed URLs configured, it safely scans zero feeds.

See SECURITY.md for the Firebase least-privilege gate and security boundaries.
