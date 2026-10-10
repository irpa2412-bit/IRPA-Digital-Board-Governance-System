# IRPA Grant Crawler

An isolated Cloudflare Worker for collecting public funding call metadata from approved RSS/Atom feeds. Initial staging storage is a dedicated D1 database. Firebase synchronization is intentionally off until collection specific least privilege rules and a dedicated identity are reviewed and tested.

## Local checks

    cd cloudflare/grant crawler
    npm run check

## Staging prerequisites
Configure GitHub Actions secrets CLOUDFLARE_GRANT_CRAWLER_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and GRANT_CRAWLER_CONTROL_TOKEN (at least 32 characters). Optionally set GRANT_CRAWLER_FEED_URLS to a JSON array of official HTTPS RSS/Atom feed URLs. Use a dedicated CLOUDFLARE_GRANT_CRAWLER_API_TOKEN, not the production gateway token. Grant only the Workers Scripts write/deploy and D1 edit permissions required for this staging deployment. If Cloudflare cannot resource-scope these permissions to the crawler, isolate it in a dedicated Cloudflare account.

Run the IRPA Grant Crawler — Isolated Staging workflow manually after its pull request has been reviewed. It deploys only irpa-grant-crawler-staging; it does not touch irpa-google-drive-gateway or deploy Firebase.

## Endpoints
- GET /health: returns service/environment/storage status, without secrets.
- POST /crawl: requires Authorization: Bearer <CRAWLER_CONTROL_TOKEN>.
- Scheduled scan: every six hours in the staging environment; with no feed URLs configured, it safely scans zero feeds.

See SECURITY.md for the Firebase least-privilege gate and security boundaries.

## AI grant application assistant

The assistant uses the Cloudflare Workers AI binding (model `@cf/meta/llama-3.1-8b-instruct`); no external AI API key or Google/Firebase route is used. Requests are limited to 20 KB and require the crawler control token. It compares supplied call text against IRPA's known organizational profile, returns a structured requirement matrix and marks missing information as unknown. It must not be treated as a donor eligibility decision; official call guidelines remain authoritative. Send `task: "concept_note"` to generate a tailored structure and draft.
