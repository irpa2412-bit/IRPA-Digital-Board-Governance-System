# Grant Intelligence AI Upgrade — Corrected Integration Inspection

**Date:** 30 October 2026  
**Branch:** `feat/grant-intelligence-ai-20261030`  
**PR:** #586 (draft; not merge-ready)

## Decision

The implementation must extend the existing Grants Intelligence & Funding Opportunities portal. Do not create another portal page, opportunity store, or AI route. This branch currently contains no duplicate implementation scaffolding: its only added file is this inspection report. The previous report's proposed separate `/intelligence/analyze` route was superseded by the user's correction and must not be implemented.

## 1. Exact existing modules to reuse

| Capability | Existing path / resource | Reuse boundary |
|---|---|---|
| Grants Intelligence & Funding Opportunities page | `src/pages/GrantIntelligencePortal.jsx` | Extend the existing page only |
| Opportunity list | `GrantIntelligencePortal.jsx`, `filtered.map(r => ...)` in the Opportunity register | Keep the existing combined record list |
| Opportunity detail | Same file, each opportunity's native `<details>` card and expanded detail block | Put Analyse action/results inside this existing detail |
| Existing selected-opportunity workspace | Same file, `openConceptWorkspace` and `runWorkspaceAnalysis` | Reuse its selection, state, forms and result rendering |
| Manually registered opportunities | Firestore collection `grantOpportunities` | Read as existing records; do not replace |
| Crawler-discovered opportunities | D1 table `grant_opportunities`, exposed by existing `GET /opportunities` | Read-only source; preserve original crawler ID |
| Crawler run telemetry | D1 `crawler_runs`, `crawler_engine_runs` | Read-only; no changes |
| Existing saved assistant documents | Firestore `grantAssistantDocuments` | Existing assistant history; not the opportunity-analysis store |
| Existing crawler Worker/router | `cloudflare/grant-crawler-parallel/src/index.js` | Reuse existing Worker, CORS and Firebase ID-token verification |
| Existing AI assistant | `cloudflare/grant-crawler-parallel/src/assistant.js` | Extend existing `analyzeGrant` task/schema; retain old task contracts |
| Existing application draft API | `cloudflare/grant-crawler-parallel/src/application-portal.js` and `src/application-portal-handler.js` | Reuse existing draft save/audit workflow |
| Existing D1 schema/migrations | `cloudflare/grant-crawler-parallel/migrations/0001_initial.sql`–`0009_engine_partial_status.sql` | Add only an analysis-results table migration if persistence remains in D1 |
| Existing styles | `src/styles/grant-intelligence-layout.css` plus inline `styles` in the page | Reuse; no second stylesheet/page |
| Shared application shell | `src/App.jsx` — `.app-shell`, `.main-area`, `.content-area`, `active-portal-content` | No new shell or route |

### Existing Worker routes

- `GET /health`
- `GET /opportunities` — authenticated, reads crawler opportunities and crawler metadata.
- `POST /crawl`
- `POST /run`
- `POST /assistant/analyze` — existing Firebase ID-token verification / configured control-token path, then `analyzeGrant(request, env)`.
- `POST /fundraising/search`
- Existing application/draft endpoints are routed through `handleApplicationPortal` for `/`, `/application`, and `/application/drafts...`.

The correction specifically means the new analysis request is a new task handled by `POST /assistant/analyze`; do not add `/intelligence/analyze`.

## 2. New files and duplicate audit

| New file on this branch | Duplicates existing implementation? | Action |
|---|---|---|
| `docs/GRANT_INTELLIGENCE_AI_UPGRADE_AUDIT_20261030.md` | No. It is documentation only. | Retained and corrected. |

**No new portal page, opportunity collection, Worker route, AI module, or layout shell has been created.** There are therefore no duplicate code files to delete. The proposed separate-route design in the earlier version of this report has been removed.

## 3. Integration design to implement

1. Preserve the existing combined opportunity list and use its source-specific identifiers. Crawler records retain their D1 `grant_opportunities.id`; manually registered records retain their Firestore document ID. Never write analysis fields back into either source.
2. Extend the existing `/assistant/analyze` request with a separately validated task for evidence-cited opportunity analysis. Existing `eligibility`, `concept_note` and `draft_message` behavior must remain compatible.
3. Store analysis snapshots in one additive analysis-results collection/table, each record containing source type, source opportunity ID, source-text hash, result JSON, model/version and timestamps. This is an analysis-results store only, not an opportunity store. Read and write authorization must use the existing Worker identity boundary.
4. Add the Analyse control and inline result panel inside each existing opportunity `<details>` card. Reuse the existing signed-in Firebase user, Worker URL, styles, status/error state and mobile wrapping.
5. Cache only successfully saved analysis snapshots for offline reading. Offline display must be marked stale/read-only and must never invoke or imply a live AI analysis.
6. Put the AI feature flag in the existing Worker environment and default it to OFF, including production. No deployment is authorized.
7. Keep editable IRPA/donor profile records within existing administrator-authorized portal functionality; do not create another portal or expose sensitive employee, board, financial or identity data to the model.

## 4. Execution and verification status

The connected GitHub interface permits repository inspection and file/PR operations. It does not expose a repository terminal, Cloudflare D1 runtime, production Worker logs, browser automation, or the authenticated live portal session. No safe way was available in this run to click Analyse against ten real live records or inspect the saved analysis links.

| Check | Result | Reason |
|---|---|---|
| Exact existing portal/page/list/detail reuse identified | PASS (inspection) | Paths and component locations inspected |
| Existing Worker/auth/CORS/AI route identified | PASS (inspection) | Router and assistant source inspected |
| Duplicate implementation files | PASS (none found) | Only new branch file is this report |
| Baseline crawler tests | NOT RUN | No repository terminal |
| Baseline portal tests | NOT RUN | No repository terminal |
| Code implementation / integration | NOT DONE | No executable repository workspace in this connection |
| Ten live opportunity end-to-end analyses | NOT RUN | No live portal session or D1 access |
| Mobile/desktop/offline browser tests | NOT RUN | No browser automation |
| Feature flag OFF in production | NOT VERIFIED | No Cloudflare environment read access |
| Deployment | NOT PERFORMED | Explicitly prohibited |

The PR's documentation-only GitHub Actions checks are not a substitute for the crawler/portal test suites or live end-to-end acceptance.

## 5. Safety

- Crawler code, schedules, output tables and existing routes were not changed.
- Firestore rules were not changed.
- No production Worker, D1 database, secrets, variables or billing configuration were changed.
- No deployment was performed.
- Do not merge or deploy this inspection-only PR.

## 6. Required access to finish the repair

An authorized Codespaces/repository terminal is required to edit and run the actual project test suites. Read-only D1 access and a controlled authenticated staging portal session are required for ten-record end-to-end verification. Browser automation is required for mobile, desktop and offline checks. Production must remain untouched.
