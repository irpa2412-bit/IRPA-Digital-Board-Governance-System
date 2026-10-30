# IRPA-DBGS SRS and wireframe validation report

Date: 31 October 2026. PR #585. Scope: documentation only. No application source, Firestore rules, secrets, production configuration or deployment changed.

## Executive result

**Documentation coverage strengthened; full validation is NOT PASS.** The SRS now has a detailed acceptance-criteria addendum and expanded traceability. The documented baseline has requirement IDs for every listed item. Bulk browser rendering and independent document-viewer opening were not available in this run. Existing DOCX/PDF exports are structurally present but pre-date the expanded SRS and must be regenerated before release.

## 1. Inspection: missing requirement IDs

| Inventory | Baseline items | ID range | Missing IDs |
|---|---:|---|---:|
| Top-level modules | 31 | MOD-01…MOD-31 | 0 |
| Registered nested sub-portals | 15 | SUB-01…SUB-15 | 0 |
| Standalone portals | 3 | STD-01…STD-03 | 0 |
| Documented Worker route/path families | 59 | API-01…API-59 | 0 |
| Cross-cutting requirements | 10 | AI-01…AI-04, OFF-01…OFF-02, MOB-01…MOB-02, GOV-01, TRC-01 | 0 |
| **Total** | **118** | | **0** |

No item in the documented 31/15/3/59 inventory is currently unnumbered. This does not prove the route inventory is exhaustive: delegated/nested router handlers and the earlier 66-family estimate remain to be source-verified.

### Criteria found vague or not independently testable

1. **Top-level modules:** several original AC1/AC2 entries use phrases such as “the user performs the operation described in this scenario”, “corresponding portal action”, or “corresponding save or submit action”. These do not name a concrete trigger or assert exact persisted fields.
2. **Nested sub-portals:** original child-portal criteria repeat generic parent/child access language and do not identify child-specific record fields, state transitions or actions.
3. **Worker routes:** API-01…API-59 have IDs, but their original success criterion is a generic documented-success response and their negative criterion is a generic controlled 4xx. Route-specific request/response schemas, status codes, authorization and side effects are not all asserted.
4. **Standalone portals:** Dataset Registry, Research Data Collection and Release Readiness needed more complete invalid-submission, idempotent-retry, conflict and release-evidence criteria.
5. **Grant Intelligence AI:** crawler isolation/provenance, criterion-level eligibility, source-backed donor alignment and the no-dispatch boundary needed observable tests.
6. **Offline/mobile:** installability, stale-cache labels, sync conflicts, revocation and exact viewport overflow assertions needed explicit outcomes.

The addendum adds module-specific field assertions, child-portal operations, standalone-portal failure paths, AI evidence/isolation tests, offline/security tests, viewport metrics and four-part traceability. Original baseline criteria remain for traceability; AC3+ entries extend the acceptance contract. Generic API criteria remain insufficient for production acceptance until handler schemas are extracted.

## 2. Requirement counts

| Area | Requirements | Existing ACs | Added ACs | Total ACs |
|---|---:|---:|---:|---:|
| 31 top-level modules | 31 | 62 | 93 | 155 |
| 15 nested sub-portals | 15 | 30 | 45 | 75 |
| 3 standalone portals | 3 | 6 | 12 | 18 |
| Grant Intelligence AI | 4 | 8 | 8 | 16 |
| Offline, mobile and governance | 5 | 10 | 11 | 21 |
| Worker route/path families | 59 | 118 | 0 | 118 |
| Traceability control | 1 | 2 | 0 | 2 |
| **Total** | **118** | **236** | **169** | **405** |

Each top-level module has 1 requirement ID and 5 acceptance criteria. Each registered sub-portal has 1 requirement ID and 5 acceptance criteria. Each standalone portal has 1 requirement ID and 6 acceptance criteria. Each AI requirement has 1 ID and 4 acceptance criteria.

### Requirement count per top-level module

| Module | Requirement ID | Requirement count | Acceptance criteria |
|---|---|---:|---:|
| IT Operations | MOD-01 | 1 | 5 |
| Dashboard | MOD-02 | 1 | 5 |
| Induction and Orientation | MOD-03 | 1 | 5 |
| Induction Applications | MOD-04 | 1 | 5 |
| Board Members Registration | MOD-05 | 1 | 5 |
| Members & Personnel | MOD-06 | 1 | 5 |
| Invitations | MOD-07 | 1 | 5 |
| Meetings | MOD-08 | 1 | 5 |
| Resolutions | MOD-09 | 1 | 5 |
| Voting | MOD-10 | 1 | 5 |
| Actions | MOD-11 | 1 | 5 |
| Documents | MOD-12 | 1 | 5 |
| Signature Platform | MOD-13 | 1 | 5 |
| Decisions | MOD-14 | 1 | 5 |
| Risk Register | MOD-15 | 1 | 5 |
| Authorization & Approvals | MOD-16 | 1 | 5 |
| Employee Payments | MOD-17 | 1 | 5 |
| Research, Statistics and Knowledge | MOD-18 | 1 | 5 |
| Finance Portfolio | MOD-19 | 1 | 5 |
| Procurement | MOD-20 | 1 | 5 |
| Reports | MOD-21 | 1 | 5 |
| Audit Trail | MOD-22 | 1 | 5 |
| Grant Intelligence & Funding Opportunities | MOD-23 | 1 | 5 |
| Communication & Media | MOD-24 | 1 | 5 |
| Downloads | MOD-25 | 1 | 5 |
| Settings | MOD-26 | 1 | 5 |
| Add Administrator | MOD-27 | 1 | 5 |
| Department and Archive Registry | MOD-28 | 1 | 5 |
| Department Portal Builder | MOD-29 | 1 | 5 |
| External Auditor Portal | MOD-30 | 1 | 5 |
| Auditors & Special Invitees | MOD-31 | 1 | 5 |

### Standalone portals

| Portal | Requirement ID | Requirement count | Acceptance criteria |
|---|---|---:|---:|
| Dataset Registry | STD-01 | 1 | 6 |
| Research Data Collection | STD-02 | 1 | 6 |
| Release Readiness | STD-03 | 1 | 6 |

## 3. Validation table

| Check | Result | Evidence / limitation |
|---|---|---|
| Requirement IDs: 31 modules | PASS | MOD-01…MOD-31 assigned |
| Requirement IDs: 15 sub-portals | PASS | SUB-01…SUB-15 assigned |
| Standalone portal separation | PASS | STD-01 Dataset Registry, STD-02 Research Data Collection, STD-03 Release Readiness remain distinct |
| Requirement IDs: 59 documented route families | PASS WITH SCOPE LIMIT | API-01…API-59 assigned; nested handler inventory not exhaustive |
| Unique requirement count | PASS | 118 documented IDs |
| Acceptance criteria count | PASS (DOCUMENT COUNT) | 405 after addendum; test execution not implied |
| Module-level detailed AC | PASS (DOCUMENT) | 3 new Given/When/Then criteria per module |
| Sub-portal detailed AC | PASS (DOCUMENT) | 3 new child-specific Given/When/Then criteria per sub-portal |
| Standalone portal criteria | PASS (DOCUMENT) | 4 new criteria per standalone portal |
| Grant Intelligence AI scope | PASS (DOCUMENT) | Crawler isolation, evidence-backed eligibility, donor alignment, concept-note advisor; analysis only |
| Offline/installable requirements | PASS (DOCUMENT) | Installable shell, stale-cache labels, idempotent sync, revocation boundary |
| Mobile layout stack | PASS (DOCUMENT) | 390×844 assertions specified |
| Desktop layout stack | PASS (DOCUMENT) | 1440×900 assertions specified |
| Backup/retention/DR management gate | PASS (DOCUMENT) | TO BE APPROVED BY IRPA MANAGEMENT; defaults explicitly unapproved |
| Requirement→page→test→AC traceability | PASS (DOCUMENT) | Proposed test IDs; no test execution implied |
| HTML index inventory | PASS (STATIC INVENTORY) | Index lists 72 page links |
| HTML parse of all 72 files | NOT RUN | No bulk HTML5 parser/browser runner available |
| Chromium 390×844 render of all 72 | NOT RUN | No browser automation runtime available |
| Chromium 1440×900 render of all 72 | NOT RUN | No browser automation runtime available |
| Horizontal overflow measurement | NOT RUN | scrollWidth/clientWidth could not be measured |
| DOCX package signature | PASS (STRUCTURAL ONLY) | ZIP/OOXML signature PK; 302,468 bytes; not opened in Word/LibreOffice |
| SRS PDF signature/page tree | PASS (STRUCTURAL ONLY) | PDF header %PDF-1.4; page tree count and page objects indicate 23 pages |
| Wireframe PDF signature/page tree | PASS (STRUCTURAL ONLY) | PDF header %PDF-1.4; page tree count and page objects indicate 72 pages |
| DOCX/PDF current-source freshness | FAIL | Existing exports pre-date new addendum and SRS.md link; regenerate all three |
| Independent DOCX/PDF viewer opening | NOT RUN | Word/LibreOffice and independent PDF viewer unavailable |
| Live authenticated application | NOT RUN | Outside documentation-only validation scope |

## 4. All failures and corrective disposition

| ID | Failure / gap | Disposition in this run |
|---|---|---|
| F-01 | Generic module criteria lacked observable field/state assertions | Added AC3–AC5 for each of 31 modules; AC1/AC2 retained for traceability |
| F-02 | Generic child-portal criteria lacked child-specific operations | Added AC3–AC5 for each of 15 sub-portals |
| F-03 | Standalone portal edge cases and sync/release evidence incomplete | Added AC3–AC6 for all three standalone portals |
| F-04 | AI requirements lacked full provenance and analysis-only assertions | Added two criteria to each AI requirement |
| F-05 | Offline install, revocation and sync-conflict tests lacked exact outcomes | Added install/cache/security/idempotency criteria |
| F-06 | Responsive requirements lacked measurable overflow criteria | Added scrollWidth <= clientWidth assertions at 390×844 and 1440×900; actual browser run remains NOT RUN |
| F-07 | API-01…API-59 remain generic without handler-specific schemas | Recorded as a blocking source-inspection item; do not mark API tests executable until method/path/auth/request/response/side-effects are extracted |
| F-08 | DOCX/PDF exports stale relative to expanded SRS | NOT FIXED: binary regeneration/replacement requires a document-generation runtime unavailable in this execution |
| F-09 | 72-page bulk HTML parse and two-viewport Chromium render unavailable | NOT FIXED: browser runtime unavailable; no false PASS recorded |
| F-10 | Independent document-viewer opening unavailable | NOT FIXED: external viewer unavailable; only signature/page-tree checks recorded |

## 5. Backup, retention and disaster recovery

**TO BE APPROVED BY IRPA MANAGEMENT.** Proposed default only: daily encrypted backups, 30-day rolling retention, monthly isolated restore test, RPO 24 hours and RTO 48 hours. Legal hold, deletion exceptions, encryption/key custody, backup scope, off-site location and recovery authority require management approval. This proposal is not production policy.

## 6. Remaining open decisions

1. IRPA Management approval of backup scope/frequency, retention, legal hold, encryption/key custody, restore testing, RPO/RTO and disaster-recovery authority.
2. Product-owner approval of role × module × action permissions and workflow state machines.
3. Confirm standalone portal navigation and accountable owners/stewards for all three standalone portals.
4. Complete delegated/nested Worker route, method, schema, authentication and side-effect inventory; reconcile 59 documented families with the earlier 66-family estimate.
5. Approve offline cache classes, expiry, revocation, sync-conflict policy and device-loss response.
6. Confirm accessibility target (proposed WCAG 2.2 AA) and measurable performance/load targets.
7. Confirm Actual/Trial environment gate and temporary gateway-disconnect flag ownership.
8. Implement and execute the 405 proposed acceptance criteria; requirement IDs and written criteria are not execution evidence.
9. Parse all 72 HTML files and render with Chromium at both requested viewports; record per-file overflow and console errors.
10. Regenerate DOCX, SRS PDF and 72-page wireframe PDF from updated sources, then open in Word/LibreOffice and an independent PDF viewer.
11. Complete authenticated browser, integration, security and recovery acceptance.

## 7. Change boundary

Documentation only. No application code, Firestore rules, secrets, production configuration or deployment changed. PR #585 remains open and unmerged.
