# Grant Intelligence AI Upgrade — Inspection Gate Report
**Date:** 30 October 2026  
**Repository:** `irpa2412-bit/IRPA-Digital-Board-Governance-System`  
**Base:** `main` at `f20403e6f26c296f9d3aa3cda87588115a0f694d`  
**Branch:** `feat/grant-intelligence-ai-20261030`

## Executive result

**Implementation and acceptance testing are blocked in this execution environment.** The repository was inspected through read-only GitHub file/tree APIs, and a documentation-only branch was created. No crawler code, Worker configuration, schedules, database migrations, Firestore rules, production resources, secrets, or billing settings were changed. No deployment was performed.

This is deliberately not represented as a completed AI upgrade. The available GitHub connection can inspect and commit repository files, but it does not provide a Codespaces terminal, local checkout, test runner, Cloudflare account telemetry, D1 data access, browser automation, or production Worker logs. Consequently it cannot safely establish the requested baseline, run or compare tests, exercise ten real crawled records, reproduce the browser failure, or validate responsive/offline behavior.

## 1. Existing architecture observed

### Discovery and storage
The active parallel crawler is under `cloudflare/grant-crawler-parallel/`:
- `src/index.js` orchestrates scheduled and manual discovery and serves `/health`, `/opportunities`, `/crawl`, `/run`, `/fundraising/search`, and `/assistant/analyze`.
- `src/discovery-engines.js` contains the RSS/Atom, official-page, web-search/GDELT and donor-specific discovery engines.
- RSS/Atom, official pages, web search, GDELT and the donor scanners feed the shared D1 `grant_opportunities` register. Crawler run telemetry is stored in `crawler_runs` and `crawler_engine_runs`.
- The crawler upserts its own opportunity rows by URL. This upgrade must not alter that pipeline or those records.
- Existing migrations `0001_initial.sql` through `0009_engine_partial_status.sql` include crawler storage and prior fit/triage, deadline, draft-audit, parallel-discovery and provenance work. Existing migrations and tables were inspected by repository tree; the live D1 schema was not queried.

The crawler README describes 29 discovery engines and a six-hour schedule in staging/production. The checked-in Wrangler file names separate staging and production Workers and D1 databases. The live deployed schedule and database bindings were not queried.

### Portal
The primary UI is `src/pages/GrantIntelligencePortal.jsx`. It already has opportunity retrieval, an eligibility/concept-note workspace, saved drafts/audit events, manual crawler actions and a general assistant. The portal uses the grant-crawler Worker URL from `VITE_GRANT_CRAWLER_WORKER_URL` (with a production fallback). It calls `POST /assistant/analyze` for eligibility and concept-note tasks.

### Existing AI route and model
`cloudflare/grant-crawler-parallel/src/assistant.js` exports `analyzeGrant`. It currently uses the Cloudflare Workers AI binding `env.AI` and model:
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`.

The route requires a verified Firebase ID token (or the configured crawler control token), validates a JSON body, limits the request to 20 KB, and returns 503 if the AI binding is unavailable. It currently accepts a title plus description or donor requirements; it does not fetch and parse the complete official call itself. Its prompt explicitly says not to browse or claim donor-site verification and to mark missing evidence as unknown. The current IRPA profile is hard-coded in this module.

### Existing “Failed to fetch” behavior
The portal's `runWorkspaceAnalysis` call posts to `/assistant/analyze` with a 90-second `AbortSignal.timeout`. It parses a JSON error where possible and displays a timeout-specific message; other fetch/network failures are surfaced from the thrown error. The code has no explicit retry/backoff for this call. The existing route's request limit is 20 KB. The code inspection alone cannot identify the historical cause of a particular browser “Failed to fetch”: no browser network trace, Worker invocation log, CORS preflight trace, account telemetry or failure timestamp/log was available.

## 2. Baseline test inventory — not executed

The repository defines these relevant checks:
- Crawler baseline: `cd cloudflare/grant-crawler-parallel && npm run check` (syntax checks plus `node --test test/worker.test.js`).
- Crawler test suite: `cd cloudflare/grant-crawler-parallel && npm test`.
- Portal fundraising registry: `npm run test:fundraising-registry`.
- Portal navigation: `npm run test:portal-navigation`.
- Responsive fundraising browser test: `npx playwright test tests/browser/fundraising-registry-responsive.spec.mjs --config=playwright.fundraising.config.mjs` (requires installed browser dependencies).
- Production build: `npm run build`.

No baseline command was run. Therefore there are no baseline pass/fail counts to compare, and no zero-regression claim can be made.

## 3. Required additive design before implementation

The safe implementation should be isolated behind a new Worker feature flag such as `GRANT_INTELLIGENCE_AI_ENABLED`, defaulting to `false` for production and all unspecified environments. Keep the current `/assistant/analyze` contract unchanged.

Proposed additive surface:
1. A separate `POST /intelligence/analyze` route with Firebase authentication, strict input/output schemas, request-size and text-length bounds, per-user rate limiting, explicit AI binding timeout, structured error codes, and no secrets returned to the browser.
2. Separate D1 tables/migrations for immutable-per-run opportunity analyses, versioned editable IRPA profile, and editable donor profiles. Every analysis row references the existing opportunity ID and stores a source snapshot/hash, model/version, timestamp, status and structured result. Never update or delete crawler rows.
3. Evidence-first extraction: each field is either `NOT STATED` or a value with one or more verbatim source excerpts and offsets/section references from the supplied call text. Do not infer facts from donor identity or crawler metadata. Require official call text/URL evidence to be supplied or safely fetched server-side with HTTPS/redirect/size/host controls; an aggregator summary alone must be labelled secondary evidence.
4. Eligibility matrix with `PASS`, `FAIL`, or `UNCLEAR` for geography, applicant type/legal status, thematic fit, budget, partnership and deadline. Theme score must be accompanied by an explainable rubric and cited evidence; it is not a donor decision.
5. Donor profiles derived only from available crawled source evidence, with provenance and editable admin overrides clearly distinguished from extracted facts.
6. Concept-note scaffolding constrained by the donor's evidenced format, including budget headings rather than invented amounts, explicit evidence gaps, risks and a call/donor compliance checklist. Draft-only human-review warning.
7. Portal integration with an `Analyse` action per opportunity, a mobile-safe result drawer/panel, explicit progress/timeout/retry states, and locally cached read-only copies of saved analysis results for offline viewing. Offline mode must never imply a fresh analysis.
8. Minimize outbound context: send only the call text and the minimum organization profile fields required for the requested checks. Do not send member, board, financial-account, identity or other sensitive records.

The existing AI binding and model are present in code, but the connected Cloudflare account's Workers AI quota, usage, and billing meter were not accessible. Therefore actual cost/free-tier headroom is **unverified**; do not assume zero marginal cost or enable production until the account's current allowance is confirmed.

## 4. Requested bulk acceptance tests — not executed

| Acceptance item | Result | Evidence / blocker |
|---|---|---|
| Existing crawler baseline | NOT RUN | No repository terminal/test runner |
| Existing portal baseline | NOT RUN | No repository terminal/browser runner |
| Ten live crawled opportunities / donor diversity | NOT RUN | No D1 access or crawled-record export |
| One non-Tanzania opportunity | NOT RUN | No D1 sample records |
| One opportunity with missing details | NOT RUN | No D1 sample records |
| Exact-text citation audit | NOT RUN | No official call text corpus |
| Non-invention / NOT STATED audit | NOT RUN | No sample outputs to inspect |
| Eligibility verdict audit | NOT RUN | No sample outputs or authoritative criteria |
| AI service unavailable | NOT RUN | No Worker runtime or controllable AI binding |
| Timeout | NOT RUN | No Worker runtime |
| Empty call | NOT RUN | No route test execution |
| Very long call | NOT RUN | No route test execution |
| Mobile / desktop | NOT RUN | No browser automation |
| Offline saved analysis | NOT RUN | Feature not implemented |
| Baseline/final regression comparison | NOT POSSIBLE | Neither run is available |
| Production feature flag OFF | NOT VERIFIED | No Cloudflare environment read access |

No failures have been represented as fixed because the acceptance tests could not be run.

## 5. Three sample analyses

Not supplied. Producing sample analyses without real crawled records and the exact official call text would violate the requirement that every extracted item cite its source and that missing details never be guessed.

## 6. Human actions required before implementation can be accepted

1. Provide an execution path with repository checkout and terminal access (for example, an authorized Codespaces session) so the baseline and final test commands can run.
2. Provide a read-only export or authorized test access to at least ten current D1 opportunity records, including their full source text/official call URLs. Do not provide secrets in chat.
3. Provide read-only access to Cloudflare Worker invocation logs and AI usage/quota telemetry, or export the relevant failure-window logs, to diagnose “Failed to fetch” and verify cost.
4. Confirm which IRPA profile fields may be exposed to the AI service; use the minimum non-sensitive profile only.
5. After code review and test evidence, approve any separate staging deployment. Production must remain disabled until separately authorized.

## Safety and change record
- Crawler workflow, schedules, crawler collections and existing routes: unchanged.
- Firestore rules: unchanged.
- Cloudflare secrets, variables, deployments and billing: unchanged.
- Production: unchanged; no deployment.
- This branch contains this inspection/acceptance-gate report only. It is not the requested feature implementation and must not be treated as ready for merge or deployment.
