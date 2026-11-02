# Grant Intelligence portal audit

**Baseline:** `main` at `cc53fad6a6e15e46ab0f3a31fea91d222f1de4e9` (web build `cc53fad`, 2026-11-01 15:08Z).  
**Production bundle:** supplied build identifier matches this main commit. Source was inspected; a separate minified artifact was not available for byte-level inspection.

| Intended change / requirement | In main? (file and lines) | In current production bundle? |
|---|---|---|
| Authenticated discovery/analysis portal | Yes — `src/pages/GrantIntelligencePortal.jsx:551-568,626-640,831-853` | Yes |
| Crawler hydration, pagination, source-health mapping | Yes — `GrantIntelligencePortal.jsx:201-223`; `grant-crawler-board-data.js:1-42` | Yes |
| Discovery engines and official-call verification labels | Yes — `cloudflare/grant-crawler-parallel/src/index.js:156-160`; `grant-crawler-board-data.js:12-27` | Yes |
| Search, pillar/theme filters, opportunity register, eligibility/fit analysis | Yes — `GrantIntelligencePortal.jsx:244-300,415-482,822-840` | Yes |
| AI concept-note drafting and private saved drafts | Yes — `GrantIntelligencePortal.jsx:174-193,360-410,483-507`; Worker `/application/drafts` | Yes |
| Discovery/analysis only; no in-system donor contact/external submission | No (UI contradiction) — SRS `docs/srs/SRS.md:944-946,963-970`; pipeline UI `GrantIntelligencePortal.jsx:595-625` | No |
| Remove submitted/awarded pipeline and dependent counter | No — `GrantIntelligencePortal.jsx:592-625`; counter at `248,593` | No |
| Executive Director-only approval, never Board/governance | Spec yes; route/enforcement no — `SRS.md:944-959,963-972`; GR-10 marks server enforcement GAP at line 972; draft API persists status `draft` only | No |
| Suppress no-deadline + “Pending official-call verification” from Open calls | No — helper `GrantIntelligencePortal.jsx:96-109` bypassed at `248,274-278` | No |
| Strip HTML/entities, remove navigation boilerplate, cap at 280 chars | No — raw mapping at `grant-crawler-board-data.js:12,19` | No |
| Unit cleaning tests and authenticated desktop/mobile assertions | No — prior mapping tests and authenticated fixture lacked these assertions | No |

## PRs, issues and specifications reviewed

- **PR #235:** original portal, opportunity register, status controls and access rules; pipeline controls later contradicted by SRS.
- **PR #266:** parallel discovery engines and shared D1 opportunity register.
- **PR #343:** existing AI assistant token/model reliability.
- **PR #346:** canonical Firestore-backed crawler, opportunity retrieval, draft storage and telemetry.
- **PR #362:** GDELT rate-limit handling and safe search fallback.
- **PR #453:** canonical crawler Worker endpoint fallback.
- **PR #585:** authoritative SRS/wireframe decision: authorised management staff prepare; Executive Director alone approves/returns; external submission is outside the system; discovery/analysis only; governance queues excluded. Server-side ED approval enforcement remained a GAP.
- **PR #586:** reuse existing portal and `/assistant/analyze`; no duplicate portal/store/AI route.
- **PR #587:** field-entry gate tests and diagnostics; recorded D1 quota/browser diagnostic failure.
- **PR #591:** crawler hydration, pagination, telemetry and responsive browser repairs.
- **PR #593:** authenticated emulator-backed Playwright tests for existing AI analysis route, mobile and desktop.

## Approval-flow limitation

The current `/application/drafts` API persists owner-scoped drafts with status `draft`; no implemented, verifiable Executive Director approval endpoint was found. This patch removes misleading application/pipeline controls and states the Executive Director-only boundary. It does not fabricate an approval route or use Board/governance workflow as an alternative. A separately authorized backend approval implementation remains required before claiming GR-02–GR-04/GR-10 complete.

## Safety

Existing Firestore and D1 records remain untouched. No Firestore rules, secrets, production Worker configuration, database schema, production deployment or merge.

## Additional related PR ledger

The following grant/funding PR titles and descriptions were also checked. “Main / production” refers to whether the substantive capability is present in the `cc53fad` source/build; a proposal being open does not make its branch changes part of production.

| PR | Intended change | State | Main / production |
|---|---|---|---|
| #236 | Evidence-based eligibility screening and tailored grant enquiry | Open | Partially — current portal has eligibility analysis and concept-note tools; the PR branch is not merged |
| #239 | Move crawler runtime to Cloudflare Workers | Merged | Yes — current crawler/Worker architecture |
| #241 | Isolated staging crawler | Open | No — staging proposal is not part of the production bundle |
| #243–#246 | AI assistant, owner-scoped application drafts, Tanzania eligibility and integrated concept-note workspace | Merged | Yes — current assistant, draft and eligibility workspace |
| #261, #264, #268–#269 | Parallel donor-specific scanners, readable engine status and FundsforNGOs discovery | Merged | Yes — discovery engine and provision panels |
| #267 | Duplicate ten-scanner proposal | Open; superseded in part by merged #268 | No additional delta established in main |
| #270 | Official-page scanner 404 handling | Open | No — branch change not merged |
| #272–#276 | Smart keyword assistant, resource directory and engine provision panel | Merged (with #273 superseded by #274) | Yes — smart keyword panel, resource directory and source-engine health |
| #343, #346 | AI assistant reliability and canonical crawler integration | Merged | Yes — existing assistant route and Firestore-backed portal integration |
| #362 | GDELT 429 handling and Bing RSS fallback | Open | No — PR remains unmerged |
| #453 | Canonical crawler Worker endpoint fallback | Closed without merge | No — main still contains the older fallback literal in portal request paths; requires a separate routing repair |
| #468 | Persist AI assistant documents across sessions | Merged | Yes — saved private document history |
| #469 | Submitted/awarded grant entry form and register | Merged | Yes — the now-removed UI was introduced by this PR; stored records remain untouched |
| #480, #511 | Authenticated full-catalogue scan and user scan access | Merged | Yes — manual full-catalogue scan controls and authenticated Worker request |
| #585 | SRS and wireframe governance/management boundary | Merged | Yes in specification; UI/backend approval enforcement was not implemented |
| #586 | Reuse the existing portal and `/assistant/analyze`; no duplicate app/store/route | Open | Architecture is already reflected in main; inspection-only PR itself is not merged |
| #587 | Fail-closed field-entry gate and crawler environment diagnostics | Open | Partially — field gate and tests are represented; reported crawler diagnostic failure remains unresolved |
| #588, #592 | Deterministic eligibility/fit/validity engine and authenticated `/pipeline/evaluate` analysis | Merged | Yes — retained as analysis, not an application-submission pipeline |
| #591 | Crawler hydration, pagination, source telemetry and responsive repairs | Merged | Yes — current mapper/pagination integration |
| #593 | Authenticated emulator-backed Analyse response tests | Open | Partially — existing authenticated fixture is present; this PR's new mocked-response coverage is not merged |
| #621 | This repair | Open, ready for review | Not in main/production until separately merged and deployed |

**Open issue search:** no open issue titled or matching the exact “Grant Intelligence” / “grant pipeline” queries was returned. Relevant requirements and outstanding implementation gaps are recorded in `docs/srs/SRS.md`, `docs/srs/ACCEPTANCE-CRITERIA-ADDENDUM.md`, and the PR #585 validation documents.

**Current Open calls interpretation:** the corrected count includes records for which the deterministic current-call helper returns no issue and whose call status/status is Open or whose description explicitly establishes a rolling/no-fixed-deadline intake. Records with no deadline and verification status `Pending official-call verification` are suppressed even if their crawler call-status field says Open. The isolated authenticated browser fixture uses one verified future-deadline call (counted) and one no-deadline pending lead (excluded). Production opportunity rows could not be enumerated without a production Firebase ID token; no real production record list is claimed.
