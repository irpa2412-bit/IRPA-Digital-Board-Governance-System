# IRPA Grant Crawler

An isolated Cloudflare Worker for collecting public funding call metadata from approved RSS/Atom feeds. Initial staging storage is a dedicated D1 database. Firebase synchronization is intentionally off until collection specific least privilege rules and a dedicated identity are reviewed and tested.

## Local checks

    cd cloudflare/grant crawler
    npm run check

## Staging prerequisites
Configure GitHub Actions secrets CLOUDFLARE_GRANT_CRAWLER_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and GRANT_CRAWLER_CONTROL_TOKEN (at least 32 characters). Optionally set GRANT_CRAWLER_FEED_URLS to a JSON array of official HTTPS RSS/Atom feed URLs. Use a dedicated CLOUDFLARE_GRANT_CRAWLER_API_TOKEN, not the production gateway token. Grant only the Workers Scripts write/deploy and D1 edit permissions required for this staging deployment. If Cloudflare cannot resource-scope these permissions to the crawler, isolate it in a dedicated Cloudflare account.

Run the IRPA Grant Crawler — Isolated Staging workflow manually after its pull request has been reviewed. It deploys only irpa-grant-crawler-staging; it does not touch irpa-google-drive-gateway or deploy Firebase.

## Endpoints
- `GET /health`: returns service/environment/storage status, without secrets.
- `GET /application`: serves the authenticated grant application workspace.
- `GET /application/drafts`: lists the signed-in user's saved drafts.
- `GET /application/drafts/:id`: retrieves a draft owned by the signed-in user.
- `GET /application/drafts/:id/events`: returns the owner's append-only audit events for draft creation/updates; other users cannot read the event history.
- `POST /application/drafts`: saves a draft to the isolated D1 database and appends a metadata-only audit event; each draft is scoped to the Firebase user UID.
- `POST /assistant/analyze`: applies deterministic geographic and known-applicant eligibility gates, returns a requirement matrix and strategic alignment, and only drafts when eligibility is sufficiently evidenced. Browser requests use a verified Firebase ID token; service-to-service calls may use the crawler control token.
- `POST /crawl`: requires `Authorization: Bearer <CRAWLER_CONTROL_TOKEN>`.
- Scheduled scan: every six hours in the staging environment; with no feed URLs configured, it safely scans zero feeds.

## Grant application and concept-note workspace

The primary user experience is the existing IRPA-DBGS **Grant Intelligence & Funding Opportunities** portal. Its integrated concept-note workspace selects an opportunity from the existing register, screens eligibility, generates/edits a draft, and lets the user download a text version for filing through the DBGS Documents module. It provides navigation to the existing Finance Portfolio, Authorization & Approvals and Meetings modules; saving a draft does not itself submit or approve it.

The Worker `/application` HTML route is a fallback/diagnostic interface to the same isolated D1 draft APIs, not a replacement for the existing DBGS application.

Sign in with an existing IRPA Firebase email/password account. Choose a scanned opportunity to prefill its title, URL and description, or enter the opportunity manually, then paste the donor's official requirements. The AI can assess eligibility and generate editable fields for the title, executive summary, problem statement, objectives, beneficiaries, activities, results, monitoring and evaluation, sustainability, implementation arrangements, risks, budget narrative, organizational capacity and strategic alignment. Use **Copy wording** beside any field, **Copy all application wording** for a combined copy, or download a `.txt` draft. Save/synchronize to persist a private draft in D1; users can list and reopen only their own drafts. Drafts remain unsubmitted until a human transfers them to the donor portal and completes IRPA's internal review.

The workspace does not submit donor applications. Generated claims, deadlines, budgets and eligibility must be checked against official donor guidance and confirmed IRPA records. Missing evidence must be completed by staff; the AI must not invent organizational track record, audits, partners, co-financing or exact financial figures.

See SECURITY.md for the Firebase least-privilege gate and security boundaries.

## AI grant application assistant

The assistant uses the Cloudflare Workers AI binding (model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`); no external model API or Firebase processing is used for AI inference. Requests are limited to 20 KB and require a verified Firebase ID token or the crawler control token. Geographic screening excludes country-specific non-Tanzania calls (including South Africa- and Zimbabwe-restricted announcements) and suppresses calls whose eligible geography is unstated. The assistant also checks explicit applicant-type, organizational age, past-project/track-record, audit-history and cash co-financing criteria against IRPA's known profile. A model cannot override a deterministic exclusion.

IRPA Strategic Plan alignment covers all three pillars and all seven cross-cutting themes, with the themes mapped within each relevant pillar. Digital governance / DBGS, cybersecurity, nonprofit board technology, cloud infrastructure and responsible AI are screened as a separate strategic investment track. A concept-note draft is blocked while geographic eligibility is unclear, a known mandatory criterion fails, or required evidence remains unresolved. The assessment remains advisory; official call guidelines and IRPA records are authoritative.
