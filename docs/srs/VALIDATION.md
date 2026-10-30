# IRPA-DBGS SRS and wireframe — bulk validation report

Date: 30 October 2026. Documentation only; no application code, Firestore rules, secrets, production settings or deployment changed.

## Inspection findings
- PR head initially contained only `docs/srs/VALIDATION.md`; the SRS, DOCX, PDFs and 72 HTML wireframes described in its PR body were absent.
- All 31 modules, 15 sub-portals and 59 explicit Worker path/families lacked requirement IDs in PR artifacts.
- No existing acceptance-criteria corpus was available to assess for vagueness; the earlier claim of 55 requirements lacked an SRS file on the PR head.

## Coverage
- 31 top-level modules: 1 requirement each, 2 Given/When/Then criteria each.
- 15 registered sub-portals: 1 requirement each, 2 criteria each.
- 3 standalone portals: 1 requirement each, 2 criteria each.
- 59 route/path families: 1 requirement each, 2 criteria each.
- 10 cross-cutting requirements; total 118 unique requirements and 236 criteria. All tests are PROPOSED until executable test artifacts are linked.

## Module requirement counts
| Module | Requirement | Count |
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

## Sub-portal requirement counts
| Parent | Sub-portal | Requirement | Count |
|---|---|---|---:|
| Meetings | Meeting Room | SUB-01 | 1 |
| Meetings | Participants | SUB-02 | 1 |
| Meetings | Resolutions | SUB-03 | 1 |
| Meetings | Voting | SUB-04 | 1 |
| Meetings | Actions | SUB-05 | 1 |
| Meetings | Decisions | SUB-06 | 1 |
| Documents | My Documents | SUB-07 | 1 |
| Documents | Department Documents | SUB-08 | 1 |
| Documents | Shared With Me | SUB-09 | 1 |
| Documents | Signing Workspace | SUB-10 | 1 |
| Documents | Post-Signature Work | SUB-11 | 1 |
| Documents | Final Archive | SUB-12 | 1 |
| Documents | Upload Document | SUB-13 | 1 |
| Documents | Retrieve Archived Documents | SUB-14 | 1 |
| Induction and Orientation | Induction Applications | SUB-15 | 1 |

## Route requirement inventory
| ID | Worker | Route/path family |
|---|---|---|
| API-01 | Drive Gateway Worker | `GET /health` |
| API-02 | Drive Gateway Worker | `POST /oauth/start` |
| API-03 | Drive Gateway Worker | `GET /oauth/callback` |
| API-04 | Drive Gateway Worker | `GET/POST /api/system/release-readiness` |
| API-05 | Drive Gateway Worker | `/api/communications/meta/*` |
| API-06 | Drive Gateway Worker | `/api/communications/*` |
| API-07 | Drive Gateway Worker | `/api/document-lifecycle/*` |
| API-08 | Drive Gateway Worker | `POST /api/communication-media-archive/provision` |
| API-09 | Drive Gateway Worker | `POST /api/research-archive/provision` |
| API-10 | Drive Gateway Worker | `POST /api/upload` |
| API-11 | Drive Gateway Worker | `POST /api/upload-controlled-document/policy-check` |
| API-12 | Drive Gateway Worker | `POST /api/upload-controlled-document/register` |
| API-13 | Drive Gateway Worker | `POST /api/upload-controlled-document` |
| API-14 | Drive Gateway Worker | `POST /api/signature-pathway/reconcile` |
| API-15 | Drive Gateway Worker | `GET /api/signature-workflow/list` |
| API-16 | Drive Gateway Worker | `GET /api/signature-workflow/view` |
| API-17 | Drive Gateway Worker | `POST /api/signature-workflow/add-signer-dry-run` |
| API-18 | Drive Gateway Worker | `POST /api/signature-workflow/draft` |
| API-19 | Drive Gateway Worker | `GET /api/system/diagnostics` |
| API-20 | Drive Gateway Worker | `GET/POST /api/system/actual-data-access` |
| API-21 | Drive Gateway Worker | `POST /api/members/reconcile-registered-identity-uids` |
| API-22 | Drive Gateway Worker | `POST /api/signature/authority` |
| API-23 | Drive Gateway Worker | `POST /api/signature-profile/folder` |
| API-24 | Drive Gateway Worker | `POST /api/signature-profile/finalize` |
| API-25 | Drive Gateway Worker | `POST /api/document-archive/folder` |
| API-26 | Drive Gateway Worker | `POST /api/document-archive/provision` |
| API-27 | Drive Gateway Worker | `POST /api/meeting-archive/provision` |
| API-28 | Drive Gateway Worker | `POST /api/meeting-archive/get` |
| API-29 | Drive Gateway Worker | `POST /api/signed-document/archive` |
| API-30 | Drive Gateway Worker | `POST /api/signature-workflow/folder` |
| API-31 | Drive Gateway Worker | `POST /api/signature-file/download` |
| API-32 | Drive Gateway Worker | `POST /api/download` |
| API-33 | Drive Gateway Worker | `POST /api/delete` |
| API-34 | Drive Gateway Worker | `POST /api/invitations/redeem` |
| API-35 | Drive Gateway Worker | `POST /api/invitations/session-state` |
| API-36 | Drive Gateway Worker | `POST /api/invitations/password-set` |
| API-37 | Drive Gateway Worker | `POST /api/send-invitation-email` |
| API-38 | Drive Gateway Worker | `POST /api/invitations/send` |
| API-39 | Drive Gateway Worker | `POST /api/signature-invitations/send` |
| API-40 | Drive Gateway Worker | `POST /api/induction/lookup` |
| API-41 | Drive Gateway Worker | `POST /api/session/profile` |
| API-42 | Drive Gateway Worker | `POST /api/esign/cleanup` |
| API-43 | Drive Gateway Worker | `GET/POST /api/documents/*` |
| API-44 | Drive Gateway Worker | `GET/POST /api/envelopes/{id}[/{status|resync|retry|retry-completion|void}]` |
| API-45 | Drive Gateway Worker | `GET/POST /api/sign/*` |
| API-46 | Drive Gateway Worker | `GET/POST /api/auth/*` |
| API-47 | Grant crawler parallel Worker | `GET /health` |
| API-48 | Grant crawler parallel Worker | `GET /opportunities` |
| API-49 | Grant crawler parallel Worker | `POST /run` |
| API-50 | Grant crawler parallel Worker | `POST /assistant/analyze` |
| API-51 | Grant crawler parallel Worker | `GET /application/drafts` |
| API-52 | Grant crawler parallel Worker | `POST /application/drafts` |
| API-53 | Grant crawler parallel Worker | `GET /application/drafts/{id}/events` |
| API-54 | Grant crawler parallel Worker | `GET /, /application, /application/drafts/*` |
| API-55 | Grant crawler parallel Worker | `POST /crawl` |
| API-56 | Grant crawler parallel Worker | `POST /fundraising/search` |
| API-57 | Grant crawler Worker | `GET /health` |
| API-58 | Grant crawler Worker | `GET /opportunities` |
| API-59 | Grant crawler Worker | `scheduled cron` |

## Bulk validation results
| Check | Result | Detail |
|---|---|---|
| HTML parser | PASS | 73 files: 72 pages + index; 0 failures |
| Index links | PASS | 72 links; 0 missing |
| Chromium viewport render | PASS | 144 checks: every page at 390×844 and 1440×900 |
| Horizontal overflow | PASS | 0 cases |
| DOCX package/CRC | PASS | ZIP opened; 17 package entries |
| DOCX application open | PASS | LibreOffice conversion succeeded |
| SRS PDF | PASS | 17 pages; pdfinfo opened |
| Wireframe PDF | PASS | 72 pages; pdfinfo opened |
| Production/live integration | NOT RUN | Outside documentation-only scope |

## Remaining gaps
- Initial PR artifact mismatch is repaired for Markdown and HTML. DOCX/PDF exports were generated and validated locally but are not committed in this GitHub update.
- Delegated nested Gateway router modules and the historic 66-route-family inventory still need exhaustive path/schema/auth extraction.
- Standalone portal navigation is proposed; source has related components but separate top-level navigation is not established.
- Executable tests are not claimed; 236 proposed test IDs need implementation and execution.
- Approved role × module × action matrix and record-level policies are not evidenced.
- Live authenticated UI and Firebase/Drive/WordPress/cPanel/SMTP/social/LiveKit probes were not run. Wireframe rendering does not validate production UI.

## Board approval required
**TO BE APPROVED BY THE BOARD.** Proposed default only: daily encrypted backup; 30-day rolling retention; monthly restore test; RPO 24 hours; RTO 48 hours.

## Open decisions
1. Approve 31 modules and 15 nested sub-portals.
2. Confirm three standalone portals and assign owners.
3. Approve role register and role × module × action matrix.
4. Approve retention/legal hold, backup, encryption/key custody, RPO/RTO and DR.
5. Confirm Grant Intelligence discovery/analysis-only scope.
6. Approve offline cache classes, expiry, revocation and sync conflict policy.
7. Approve WCAG 2.2 AA and performance/load targets.
8. Confirm Actual/Trial gate and temporary gateway-disconnect flag owners.
9. Complete delegated Gateway router enumeration, schemas, auth policy and executable tests.
10. Schedule authenticated live-app and integration acceptance testing.
