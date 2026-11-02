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
