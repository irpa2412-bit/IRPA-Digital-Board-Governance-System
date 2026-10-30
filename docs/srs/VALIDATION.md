# IRPA-DBGS SRS and wireframe — validation report

Date: 30 October 2026. Scope: documentation-only PR #585. No application code, Firestore rules, secrets, production configuration or deployment changed.

## Inspection findings

- Baseline source inventory: 31 top-level modules, 15 registered nested sub-portals and 59 explicit Worker path/families currently inventoried in the SRS.
- The first PR artifact pass had no requirement IDs for those modules, sub-portals or route families. The strengthened SRS now assigns them IDs.
- The original 236 criteria included 206 without an explicit **When** clause; five were flagged by a phrase-level scan as vague or non-testable (diagnostics "permitted", meeting "valid mandatory fields", undefined risk scale, audit denial "where supported", and dataset "permitted metadata"). This repair adds explicit When clauses to all 236 criteria and replaces those five with observable outcomes/fields. Review against product-owner policy remains required.
- The earlier report's claims of successful 144 Chromium viewport renders and successful DOCX/PDF opens could not be reproduced from the current PR tree. No browser automation runner is available in this execution environment; DOCX and PDF binaries are not present in the PR tree. Those prior PASS claims are withdrawn.

## Coverage and requirement counts

| Area | Items | Requirements per item | Criteria per item |
|---|---:|---:|---:|
| Top-level modules | 31 | 1 | 2 |
| Registered nested sub-portals | 15 | 1 | 2 |
| Standalone portals | 3 | 1 | 2 |
| Worker routes/path families | 59 | 1 | 2 |
| Cross-cutting | 10 | — | — |
| **Total** | — | **118 unique IDs** | **236** |

## Module requirement counts

| Module | Requirement ID | Count |
|---|---|---:|
| IT Operations | MOD-01 | 1 |
| Dashboard | MOD-02 | 1 |
| Induction and Orientation | MOD-03 | 1 |
| Induction Applications | MOD-04 | 1 |
| Board Members Registration | MOD-05 | 1 |
| Members & Personnel | MOD-06 | 1 |
| Invitations | MOD-07 | 1 |
| Meetings | MOD-08 | 1 |
| Resolutions | MOD-09 | 1 |
| Voting | MOD-10 | 1 |
| Actions | MOD-11 | 1 |
| Documents | MOD-12 | 1 |
| Signature Platform | MOD-13 | 1 |
| Decisions | MOD-14 | 1 |
| Risk Register | MOD-15 | 1 |
| Authorization & Approvals | MOD-16 | 1 |
| Employee Payments | MOD-17 | 1 |
| Research, Statistics and Knowledge | MOD-18 | 1 |
| Finance Portfolio | MOD-19 | 1 |
| Procurement | MOD-20 | 1 |
| Reports | MOD-21 | 1 |
| Audit Trail | MOD-22 | 1 |
| Grant Intelligence & Funding Opportunities | MOD-23 | 1 |
| Communication & Media | MOD-24 | 1 |
| Downloads | MOD-25 | 1 |
| Settings | MOD-26 | 1 |
| Add Administrator | MOD-27 | 1 |
| Department and Archive Registry | MOD-28 | 1 |
| Department Portal Builder | MOD-29 | 1 |
| External Auditor Portal | MOD-30 | 1 |
| Auditors & Special Invitees | MOD-31 | 1 |

## Validation results

| Check | Result | Detail |
|---|---|---|
| SRS requirement ID uniqueness | PASS | 118 unique requirement headers; expected 118 |
| Acceptance criteria count | PASS | 236 criteria; expected 236 |
| Explicit Given/When/Then structure | PASS | 236 criteria amended; 0 still missing a When clause |
| Previously flagged vague criteria | PASS | Five identified phrases replaced with observable fields/status/HTTP result |
| HTML index inventory | STATIC ONLY | Index lists 72 page links; actual HTML parse/render not rerun in this environment |
| HTML parser across 72 pages | NOT RUN | Repository content is accessible through GitHub connector, but no local bulk HTML parser/browser runner is available |
| 390×844 Chromium render | NOT RUN | No browser automation runner available; no overflow result claimed |
| 1440×900 Chromium render | NOT RUN | No browser automation runner available; no overflow result claimed |
| SRS DOCX generation / package structure | PASS (STRUCTURAL) | Generated from the current SRS.md source; OOXML package contains the required document, styles, relationships, content-types and document-properties parts. External Microsoft Word/LibreOffice open test was not available |
| SRS PDF structure / page count | PASS (STRUCTURAL) | Generated PDF header/trailer and page tree verified; 23 pages. External PDF viewer open test was not available |
| Wireframe PDF structure / page count | PASS (STRUCTURAL) | Generated from the 72 indexed page-specific wireframes; PDF header/trailer and page tree verified; 72 pages. External PDF viewer open test was not available |
| Live authenticated app / integrations | NOT RUN | Outside documentation-only validation scope |

## Downloadable exports added

- `SRS.docx`: generated from `SRS.md` blob `d58ac2863329b25ec231e2f1ec87fd61a001ed8b`; 302,468 bytes; OOXML package contains 7 required package parts.
- `SRS.pdf`: generated from the same SRS source; 157,334 bytes; 23 pages.
- `WIRE_FRAMES.pdf`: generated from all 72 indexed wireframe pages; 142,590 bytes; 72 pages.
- The Word package and both PDFs pass structural/signature checks performed during generation. They were not opened in Microsoft Word, LibreOffice or a desktop PDF viewer; external viewer compatibility remains unverified.

## Downloadable exports added

- `SRS.docx`: generated from the current `SRS.md` source; 302,468 bytes.
- `SRS.pdf`: generated from the same SRS source; 23 pages.
- `WIRE_FRAMES.pdf`: generated from all 72 indexed wireframe pages; 72 pages.
- External Microsoft Word/LibreOffice and independent PDF-viewer opening was not available; structural generation checks do not replace viewer acceptance.

## Failures / limitations

1. **Rendering validation incomplete:** all 72 pages still require real Chromium runs at both viewport sizes. Horizontal overflow is unverified.
2. **External document-viewer validation outstanding:** downloadable SRS DOCX, SRS PDF and wireframe PDF are now committed. Structural package/PDF checks and generated page counts pass, but opening in Microsoft Word/LibreOffice and an independent PDF viewer was not available.
3. **Route coverage incomplete:** 59 top-level Worker paths/path families are assigned API requirement IDs. Delegated nested router handlers and the previously cited 66-route-family inventory still need exhaustive path/schema/auth extraction.
4. **Executable test coverage incomplete:** 236 test IDs remain PROPOSED; no test implementation or execution is claimed.
5. **Product-owner confirmation outstanding:** role × module × action permissions, exact workflow state machines, standalone navigation, risk thresholds and operational targets require approval.

## Board approval required

**TO BE APPROVED BY THE BOARD.** Proposed default only: daily encrypted backups, 30-day rolling retention, monthly restore test, RPO 24 hours and RTO 48 hours. This is not an approved production policy.

## Open decisions

1. Confirm the 31-module baseline and 15 registered nested sub-portals.
2. Confirm Dataset Registry, Research Data Collection and Release Readiness as standalone portals; approve navigation and assign owners.
3. Approve role register and role × module × action permission matrix.
4. **TO BE APPROVED BY IRPA MANAGEMENT:** retention/legal hold, backup frequency/scope, encryption/key custody, restore-test evidence, RPO/RTO and disaster recovery. Proposed default: daily backup, 30-day retention and tested restore; not approved until management sign-off.
5. Grant workflow: authorised fundraising/management staff prepare; the Executive Director approves or returns; external submission remains outside the system. No Board approval, signature or workflow.
6. Approve offline cache classes, expiry, revocation and synchronization conflict policy.
7. Approve WCAG 2.2 AA target and measurable performance/load targets.
8. Confirm Actual/Trial gate and temporary gateway-disconnect flag ownership.
9. Complete delegated Worker route/schema/auth inventory and executable tests.
10. Run authenticated browser acceptance, integration, security, recovery and binary document validation.


## Executive Director authority correction — 31 October 2026

- Grant and Communication & Media funding approvals are assigned exclusively to the **Executive Director**. Fundraising/management staff prepare; the Executive Director approves or returns; external submission is outside this system.
- Administrator is not the grant approver. Board roles have no grant, concept-note, funding-opportunity or media-funding workflow, approval or signature permission.
- Grant Intelligence remains discovery and analysis only. Crawlers are read-only and isolated.
- Backup/retention/DR policy is **TO BE APPROVED BY IRPA MANAGEMENT**; proposed default is daily backup, 30-day retention and tested restore.
- Role/source inspection: Executive Director is already named in the Grant Intelligence page's management-role allow-list and in the Communications Site editor allow-list in application source. It is also present in Firestore meeting registrar/governance role checks. The SRS now defines an explicit grant approval permission and test requirement. Source presence does not prove that a distinct global access category or complete server-side grant approval endpoint is implemented; that remains a proposed access-control GAP requiring implementation/verification without changing code in this documentation task.

## Validation run — corrections and limits

| Check | Result | Evidence / limitation |
|---|---|---|
| Requirement coverage | PASS (document inventory) | 31 MOD, 15 SUB, 3 STD, 59 API families; new GR/ROLE/OFF/MOB/AI/DR requirements added |
| Board terms near grant/funding terms | PASS for revised SRS and three revised workflow wireframes | Grant/funding wireframe states explicitly prohibit Board routing; full repository-wide text scan is not available through the current GitHub connector and must be rerun in CI |
| Grant approval authority | PASS in revised SRS and two funding wireframes | All grant/funding approval states name Executive Director |
| Backup authority | PASS | “TO BE APPROVED BY IRPA MANAGEMENT”; daily/30-day/tested-restore proposal |
| HTML parse all 72 | NOT RUN | No HTML parser/browser execution tool available in this repository operation |
| Chromium 390×844 / 1440×900 render | NOT RUN | No Chromium/browser automation available |
| Horizontal overflow | UNVERIFIED | CSS inspection shows minmax(0,1fr), min-width:0, box-sizing:border-box and a 640px single-column breakpoint; actual render measurement unavailable |
| DOCX/PDF open and page counts | NOT VERIFIED IN THIS RUN | No document-viewer/office runtime exposed by GitHub connector; previous PR report says SRS PDF 23 pages and wireframe PDF 72 pages, but this run cannot independently reopen those binaries |
| Application code role inspection | PARTIAL PASS / GAP | Executive Director string and management allow-list exist in source; distinct grant approval entitlement and server enforcement need implementation/verification |
| Code/deploy scope | PASS | Documentation files only; no application source, rules, secrets, production configuration or deployment changed |

### Remaining open decisions
1. Management to approve backup scope, daily frequency, 30-day retention, encryption/key custody, restore-test cadence, RPO/RTO, legal hold and DR ownership.
2. Confirm formal role register and assign fundraising/management staff; provision the Executive Director grant-approval permission through the established identity/access process.
3. Verify server-side enforcement of Executive Director-only grant approvals; source role-string presence alone is insufficient.
4. Confirm standalone portal navigation and owners for Dataset Registry, Research Data Collection and Release Readiness.
5. Execute complete 72-file HTML parsing, browser renders at both requested viewports, overflow checks, and independent DOCX/PDF opens in CI or a browser-enabled build environment.
6. Implement and run proposed automated acceptance tests; they remain specifications, not passing test executions.
