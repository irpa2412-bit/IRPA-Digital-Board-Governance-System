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
| DOCX open / page count | BLOCKED | DOCX binary is absent from the PR changed-file tree |
| SRS PDF open / page count | BLOCKED | SRS PDF binary is absent from the PR changed-file tree |
| Wireframe PDF open / page count | BLOCKED | Wireframe PDF binary is absent from the PR changed-file tree |
| Live authenticated app / integrations | NOT RUN | Outside documentation-only validation scope |

## Failures / limitations

1. **Rendering validation incomplete:** all 72 pages still require real Chromium runs at both viewport sizes. Horizontal overflow is unverified.
2. **Document binaries missing:** SRS DOCX, SRS PDF and wireframe PDF are not committed to PR #585, so package-open checks and page counts cannot be independently confirmed.
3. **Route coverage incomplete:** 59 top-level Worker paths/path families are assigned API requirement IDs. Delegated nested router handlers and the previously cited 66-route-family inventory still need exhaustive path/schema/auth extraction.
4. **Executable test coverage incomplete:** 236 test IDs remain PROPOSED; no test implementation or execution is claimed.
5. **Product-owner confirmation outstanding:** role × module × action permissions, exact workflow state machines, standalone navigation, risk thresholds and operational targets require approval.

## Board approval required

**TO BE APPROVED BY THE BOARD.** Proposed default only: daily encrypted backups, 30-day rolling retention, monthly restore test, RPO 24 hours and RTO 48 hours. This is not an approved production policy.

## Open decisions

1. Confirm the 31-module baseline and 15 registered nested sub-portals.
2. Confirm Dataset Registry, Research Data Collection and Release Readiness as standalone portals; approve navigation and assign owners.
3. Approve role register and role × module × action permission matrix.
4. **TO BE APPROVED BY THE BOARD:** retention/legal hold, backup frequency/scope, encryption/key custody, restore-test evidence, RPO/RTO and disaster recovery.
5. Confirm Grant Intelligence discovery/analysis-only scope; prohibit donor contact and application submission in this scope.
6. Approve offline cache classes, expiry, revocation and synchronization conflict policy.
7. Approve WCAG 2.2 AA target and measurable performance/load targets.
8. Confirm Actual/Trial gate and temporary gateway-disconnect flag ownership.
9. Complete delegated Worker route/schema/auth inventory and executable tests.
10. Run authenticated browser acceptance, integration, security, recovery and binary document validation.
