# Grants Intelligence & Funding Opportunities Portal — Safe Fundraising Expansion Plan

**Status:** Proposal for review; not a production deployment  
**Date:** 13 October 2026  
**Repository:** IRPA Digital Board Governance System  
**Scope:** Additive fundraising capabilities for the existing Grants Intelligence & Funding Opportunities Portal.

## 1. Objective

Evolve the portal from grant-call discovery into a practical fundraising workspace that helps IRPA discover, verify, prioritize and pursue funding and non-cash partnerships from:
- Tanzanian corporate social responsibility (CSR), ESG/community-investment and corporate foundations;
- regional and international corporate foundations and sustainability programmes;
- bilateral and multilateral development partners, climate and nature finance facilities;
- private foundations, philanthropy, community foundations and NGO grant-makers;
- research, innovation, challenge funds, technical assistance, in-kind support and corporate volunteering;
- suitable open calls and rolling opportunities, while preserving the current grants workflow.

Discovery must serve IRPA's three strategic pillars—Sustainable Rangeland Management, Livestock Development and Market Development—and its cross-cutting themes: climate adaptation/resilience, gender equality and social inclusion, youth empowerment, community participation, research/innovation/knowledge management, governance/institutional strengthening and environmental sustainability.

## 2. Non-negotiable safety boundaries

1. **No changes to other portals.** Do not edit shared navigation, app shell, authentication, authorization, global CSS, service worker, shared components, Firestore rules, deployment workflows or other portal files as part of the initial expansion.
2. **Keep the current portal stable.** Preserve the summary-by-default / expand-on-demand display, existing opportunity records, eligibility advisory, expired/closed-call blocking, current source-verification behavior and existing administrative controls.
3. **Isolate new functionality.** First implement new fundraising features in dedicated portal-local modules and components. Avoid schema migrations and shared state changes in the first release.
4. **No autonomous outreach or submissions.** The tool may prepare draft outreach, partnership briefs, eligibility checklists and follow-up tasks, but must not send emails, submit applications, create external accounts, or promise IRPA funding without an authorized human action.
5. **No unsafe secrets or data exposure.** Never place API keys, credentials, donor contact private data or privileged configuration in browser code, public Firestore documents, logs or source control.
6. **No fabricated opportunities.** Every surfaced opportunity must retain its source URL, discovery timestamp, verification status, eligibility evidence and deadline confidence. Search snippets and AI classifications are leads, not proof.
7. **Rollback first.** Ship behind a portal-local feature flag/configuration switch where feasible; preserve a known-good commit and document rollback steps before any production release.

## 3. Proposed user-facing fundraising capabilities

### A. Funding-source expansion
Create a source registry grouped by:
- Tanzania-based corporate/foundation CSR and ESG;
- regional African corporate and philanthropic funders;
- global corporate foundations and sustainability programmes;
- bilateral/multilateral donors and climate/nature facilities;
- research, innovation, challenge and social-enterprise facilities;
- in-kind support, equipment, professional services, employee volunteering and technical partnerships.

Candidate sources to verify include the Foundation for Civil Society, Vodacom Tanzania Foundation, CRDB Bank Foundation, Airtel Tanzania Foundation, mining-sector community investment programmes, relevant banks and telecoms, EEP Africa, GEF Small Grants Programme, UN Partner Portal, FAO and reputable African/global opportunity directories. This is a discovery list, not a claim that any named funder currently has an open call or accepts IRPA. Verify eligibility, current programme status and the official application channel before showing an item as actionable.

### B. CSR/ESG partnership records
Add a distinct record type (without changing existing grant records) for:
- company/foundation and official source;
- geography and communities served;
- CSR/ESG theme and published priority;
- support type: cash grant, sponsorship, co-funding, in-kind, technical assistance, volunteering, research or market linkage;
- likely IRPA project/pillar match and reason;
- eligibility/registration requirements and whether they are confirmed;
- contact route published by the organization (no guessed personal contacts);
- application/engagement method, deadline or rolling status;
- evidence, last-checked date, confidence, reviewer and next action.

### C. Fundraising pipeline
Provide portal-local stages such as **Discovered → Verification needed → Qualified lead → Engagement planned → Contacted (manually confirmed) → Concept shared → Due diligence → Proposal invited/submitted (manual confirmation) → Awarded / Declined / Dormant**. Store owner, next action/date, estimated support only when sourced or explicitly marked as IRPA's estimate, and notes/audit timestamps. Never imply that a donor has been contacted or a proposal submitted unless a user records that event.

### D. IRPA project matching and readiness
Map leads to the three strategic pillars and cross-cutting themes; allow the user to select a relevant IRPA initiative, such as rangeland restoration, fodder banks, livestock services/market access, women and youth livelihoods, or the Longido Regenerative Pastoral System Living Laboratory. Give explainable fit reasons and readiness gaps. Eligibility and match scores remain advisory and cannot override donor rules.

### E. Actionable fundraising workspace
Support saved searches, priority queues, deadline alerts, follow-up reminders, donor briefings, tailored concept-note outlines, CSR pitch briefs, due-diligence checklists, and a pipeline summary. All outbound content is a draft requiring human review and explicit action.

## 4. Source acquisition and data quality

Use a tiered acquisition model:
1. official funder pages, official portals, published corporate sustainability/CSR reports and official application guidelines;
2. reputable intermediary directories and NGO funding hubs for discovery only;
3. search-engine results and crawler/AI outputs as unverified leads only.

Respect website terms, robots directives, rate limits, copyright, personal-data rules and access restrictions. Prefer official feeds/APIs and published pages; do not bypass logins, CAPTCHAs, paywalls or technical controls. Use conservative request rates, caching, conditional requests and per-source circuit breakers. Do not expand crawl frequency globally; keep new sources on a separate allowlist and schedule. Deduplicate by canonical URL plus normalized funder/title/deadline, retain source history, and distinguish deadline dates from “last updated” dates.

Required states: **Unverified**, **Verified—open**, **Rolling—verified**, **Closed/expired**, **Eligibility unclear**, **Source unavailable**. Closed/expired opportunities must not be presented as open or eligible for submission. A crawler failure must not erase previously stored records.

## 5. Technical implementation plan

### Phase 0 — Baseline and safeguards
- Record the current main commit and current portal behavior.
- Map portal-local imports, data collections, permissions and deployment dependencies.
- Add a regression checklist covering other portals, navigation, mobile/desktop layout, login, Firestore access, current grant discovery, eligibility and summary/expand behavior.
- Establish feature flag and rollback procedure before feature coding.

### Phase 1 — Isolated source registry and taxonomy
- Add new portal-local configuration/module for source categories, official URLs, source type, allowed acquisition method and crawl limits.
- Add CSR/ESG taxonomy and matching rules in isolated modules.
- Do not modify shared application shell, existing source records, crawler runtime or global deployment settings.

### Phase 2 — Lead records and fundraising pipeline
- Define a versioned, additive schema/collection with strict validation and access control.
- Reuse existing records only through read-only adapters at first; avoid destructive migrations or renaming existing fields.
- Keep donor pipeline notes private to authorized IRPA users; public opportunity visibility must not expose internal assessments or contact history.
- Add audit events for create/edit/status changes.

### Phase 3 — Acquisition and qualification
- Enable a small, manually reviewed source allowlist first.
- Run discovery in a staging environment with quotas, timeouts, bounded concurrency, retry limits, deduplication and source health monitoring.
- Use deterministic validation for deadline/status/URL and human verification for eligibility-critical facts.
- Expand source count only after quality and resource metrics meet agreed thresholds.

### Phase 4 — Drafting and engagement tools
- Add concept-note/pitch brief templates, follow-up reminders and readiness checklists.
- Keep generated text as drafts; do not auto-send or auto-submit.
- Add explicit provenance for claims and budget figures; do not infer a funder contact or funding amount.

### Phase 5 — Controlled release
- Build and run all existing checks plus new portal-local tests.
- Deploy to staging; test desktop and mobile in production-like browsers, permissions, Firestore rules, accessibility, rate limits and rollback.
- Release to a small authorized cohort behind the feature flag; monitor before enabling broadly.
- Production deployment only after CI, security review, smoke tests and rollback rehearsal pass.

## 6. Adverse impact assessment and mitigation

| Potential impact on other systems | Risk | Required mitigation / acceptance condition |
|---|---|---|
| Shared React render path, navigation or CSS regression | High | Keep changes inside portal-local components/styles; no global selectors or shared shell edits; run portal and cross-portal visual smoke tests at mobile and desktop breakpoints. |
| Firestore load, quota use or slow screens | High | Paginated reads, bounded queries, indexes reviewed in staging, no unbounded listeners, lazy-load pipeline panels, cache source results, rate-limit writes and test with representative volume. |
| Existing grant data corruption or changed eligibility logic | High | No destructive migration; additive versioned schema; regression tests assert existing eligibility and closed-call rules; backup/export and rollback tested. |
| Authentication/authorization leakage | High | Least-privilege access; security rules deny by default; separate public opportunity fields from private pipeline notes; test user/admin/unauthorized roles and direct Firestore access. |
| Crawler overload or third-party service blocks | Medium–High | Separate allowlist and scheduler; conservative concurrency and per-host rate limits; cache, backoff, circuit breaker and kill switch; never change global crawler cadence without a separate review. |
| API spend or function/runtime exhaustion | Medium–High | Start with low-cost official-page discovery; quotas and budgets, timeouts, bounded retries, token/call limits, monitoring and a disable switch; no unbounded AI agent loops. |
| Malicious page prompt injection or unsafe content | High | Treat crawled pages as untrusted data, never instructions; sanitize rendered text/URLs; prohibit crawled content from invoking tools or altering system settings; validate links and output schemas. |
| Stale, fraudulent or misleading funding information | High | Official-source verification, timestamps, evidence links, human review for eligibility/deadlines, status labels and report/withdraw mechanism. |
| Personal data or confidential donor correspondence exposed | High | Store only necessary business-contact details, prefer official generic contacts, restrict notes, minimize logs, retention policy and access audit. |
| Search engine / source terms or copyright breach | Medium–High | Respect terms, robots and rate limits; link and summarize rather than copy full calls; no authentication bypass or bulk scraping of prohibited sources. |
| Incorrect ESG or environmental claims / greenwashing | High | Do not imply company endorsement or verified impact; distinguish published commitments from actual funding; require evidence and reviewer for impact claims; avoid carbon-credit valuation or claims without credible methodology. |
| Confusing grants with sponsorship, loans or commercial investment | Medium | Separate funding/support types and label repayable finance, procurement, sponsorship, in-kind support and grants distinctly; show obligations and eligibility. |
| Failed deployment affecting unrelated services | High | Dedicated branch and pull request; no direct-to-main edits; CI and staging first; deployment change limited to approved artifacts; maintain previous deploy and rollback instructions. |

### Go/no-go criteria
Do not release if any of these occurs:
- any unrelated portal file, shared navigation, authentication, service worker or global style changes without explicit separate approval;
- existing grant records or eligibility behavior changes unexpectedly;
- authorization tests expose private pipeline data;
- crawler failures trigger unbounded retries, excessive traffic or erase records;
- production build, relevant CI, mobile/desktop smoke tests or rollback rehearsal fails;
- opportunity cards present unverified leads as verified/open or closed calls as actionable.

## 7. Verification and monitoring

Before release:
- Unit tests for taxonomy, source validation, deduplication, date parsing, state transitions and matching rationale.
- Security tests for role access, direct database access, XSS/link handling, prompt-injection resilience and private notes.
- Regression tests for existing grants, eligibility advisory, closed/expired-call blocking and expandable summaries.
- Build and all repository CI checks.
- Mobile and desktop browser smoke tests across other portals, including navigation, login, meeting, finance and other unaffected governance areas.
- Staging crawl dry-run with request counts, latency, failure rate, duplicates and source verification sample.
- Rollback drill and confirmation that existing records remain intact.

Monitor error rate, page load/render latency, Firestore reads/writes, crawler request count, failed sources, duplicate rate, verification backlog, stale opportunities, deadline accuracy, user-reported errors and any cross-portal regression. Provide a kill switch that disables new discovery and pipeline additions without disabling the existing grant portal.

## 8. Suggested initial source validation backlog

Validate official programme pages and current eligibility before activating:
- Foundation for Civil Society (Tanzania);
- Vodacom Tanzania Foundation and other Tanzania corporate foundations/CSR programmes;
- CRDB Bank Foundation and other bank/telecom corporate investment channels;
- mining-sector community investment/ESG programmes where project geography and eligibility fit;
- EEP Africa (note its published 2026 call status before treating it as open);
- GEF Small Grants Programme and relevant Tanzania country windows;
- UN Partner Portal, FAO, UNDP Tanzania and other relevant multilateral opportunities;
- African and global corporate foundations, climate/nature funds and philanthropic grant-makers.

A named organization is a prospective source, not evidence of an open call, eligibility or a likely award. Verify each opportunity against the current official source.

## 9. Acceptance outcome

The expansion is successful when IRPA users can discover verified grant and CSR/ESG partnership leads, see a clear and explainable fit to IRPA's strategy, manage a private fundraising pipeline and prepare human-reviewed outreach—while all existing grant functionality and unrelated governance portals pass regression checks. This plan itself does not authorize production deployment, new external services, schema migration or changes to shared infrastructure.
