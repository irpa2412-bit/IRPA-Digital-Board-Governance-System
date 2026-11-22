# IRPA grant crawler security boundary

## Isolation
  This is a separate Cloudflare Worker (irpa grant-crawler-staging) and separate D1 database. It must not import, bind, deploy, or alter the irpa-google-drive-gateway Worker.
- The staging workflow deploys only this directory and only the staging Wrangler environment.
- No Firebase service-account key, Firebase admin SDK, production Firestore database, mail credentials, Drive KV, or e-signature Durable Object is bound to this Worker.
- The initial crawler stores discovered public-call metadata in its isolated D1 database. It does not create applications, submit applications, send email, or write to IRPA's donor/finance collections.
- The /crawl control endpoint requires CRAWLER_CONTROL_TOKEN (minimum 32 characters); tokens are never returned by /health.

## Firebase least-privilege release gate
CLOUDFLARE_FIREBASE_SERVICE_ACCOUNT_JSON is intentionally not consumed by this Worker. A Firebase service-account private key used with the Admin SDK would bypass Firestore Security Rules and would not provide collection-level least privilege. Secret storage alone does not prove the credential is constrained.

Before enabling Firebase synchronization:
1. Provision a dedicated Firebase Auth service identity for the crawler, separate from all human administrators and the deployment service account.
2. Add and emulator-test rules that permit that identity to create/update only the dedicated grantOpportunities and grantCrawlerRuns collections, with strict field validation and no reads/writes to governance, finance, member, meeting, document, or admin collections.
3. Use Firebase client/REST authentication subject to those rules, not Admin SDK or a project-wide service-account key.
4. Test positive writes to the two approved collections and negative writes to every protected collection in a non-production Firebase staging project.
5. Only then add the narrowly scoped identity's runtime secret and an explicit opt-in sync flag. Keep sync disabled by default.

## Feed safety
- Only credential-free HTTPS feed URLs on port 443 are accepted.
- Redirects are rejected to reduce SSRF risk.
- At most 30 feed URLs are accepted; each response is limited to 1 MB and a 12-second timeout.
- Feed HTML/XML is treated as untrusted text, not rendered as HTML.
- Configure only official donor / public-call RSS or Atom feeds that permit automated access. Respect each publisher's terms and robots/access policies.

## Required GitHub Actions secrets
- CLOUDFLARE_GRANT_CRAWLER_API_TOKEN: a dedicated Cloudflare API token for this crawler staging deployment only. Grant only Workers Scripts write/deploy and D1 edit permissions for the required account; do not reuse the production gateway token. Cloudflare token permissions may be account-scoped, so use a dedicated Cloudflare account for stronger isolation if the account's token model cannot restrict access to the crawler Worker and D1 database.
- CLOUDFLARE_ACCOUNT_ID: target account ID.
- GRANT_CRAWLER_CONTROL_TOKEN: random high-entropy token (at least 32 characters).
- GRANT_CRAWLER_FEED_URLS: JSON array of approved official HTTPS RSS/Atom URLs (optional; defaults to an empty array).

No production deployment is performed by this workflow. Firebase sync and donor/finance writes remain disabled.

## AI assessment limitations
- The AI assistant only analyzes the opportunity and donor requirements submitted by an authenticated caller. It does not independently verify official donor websites.
- Treat feed/call text as untrusted data; the prompt explicitly prevents source text from overriding assistant instructions.
- Eligibility output is advisory, with unknowns and evidence gaps surfaced. IRPA staff must confirm requirements, dates, and final eligibility in official donor documents.
- Do not submit confidential personal data or sensitive application materials unless separately approved for this workflow.
