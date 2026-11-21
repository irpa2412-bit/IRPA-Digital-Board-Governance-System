# IRPA-DBGS implementation status

## Current consolidated phase ledger (authoritative)

Updated: 2026-11-21 20:07 UTC. Main includes Phase 1 deploy safeguard merge commit `5fa8d46deeeb96c3172a1798411c18f57991855d`.

| Consolidated phase | Inserted workstream | State | PR / commit | Evidence and next step |
|---|---|---|---|---|
| 1. Deploy safeguard | — | MERGED | [PR #843](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/843), `5fa8d46deeeb96c3172a1798411c18f57991855d` | All required PR checks green; production Firestore publish steps require workflow_dispatch and exact DEPLOY. Merge-commit Firebase CLI run is pending protected-environment approval; no rules files changed. |
| — | 1A. Urgent REAL/TRIAL deletion hotfix | OPEN / IN PROGRESS | [PR #844](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/844) | Creation assigns immutable environment; only admin-created explicit TRIAL is deletable; missing/invalid are REAL; meeting-register delete and record PURGE share policy. Verify all required tests, all deletion paths, merge, then deploy only after live rollback confirmation. |
| 2. Inventory | — | NOT STARTED | — | Administrator-only read-only, paginated meeting inventory; explicit TRIAL, explicit REAL, missing/invalid-as-REAL and linked-record counts. |
| 3. Access | — | NOT STARTED | — | Central role resolution, full-control roles, role-aware navigation, logged administrator grants with optional expiry. |
| 4. Protection | — | NOT STARTED | — | Complete trial deletion safeguards, atomic child cleanup, reason/title confirmation, export preview, append-only audit, versioned SHA-256 records, protected exports and emulator rules tests; prepare rules diff without publishing. |
| 5. Rules approval | — | WAITING FOR OWNER APPROVAL | — | Stop until the exact owner instruction `DEPLOY RULES`; no rules publication before approval. |
| 6. Dependencies | — | NOT STARTED | #826, #827, #815, #812, #813 | Reconcile meeting PRs in least-change order; repair portal handoffs and verify EAT, one-third quorum and full chain role-by-role. |
| 7. Signature adjustments | — | NOT STARTED | — | Cancellation/removal safeguards and responsive action bar; preserve signing order, explicit Confirm, email-link rules and signing protocol. |

Legacy numbering note: the earlier Phase 1 Worker hotfix is now designated Phase 1A because the consolidated prompt defines Phase 1 as the Firestore deployment safeguard. The earlier Phase 2 deployment safeguard is superseded by consolidated Phase 1. The earlier Phase 3 Meeting Portal sequence and Phase 4 Access/Protection are split into consolidated Phases 2–4; earlier Phase 5 Dependencies, Phase 6 Rules approval and Phase 7 Signature adjustments map to consolidated Phases 6, 5 and 7 respectively.


Last updated: 2026-11-21T19:59Z

## Baseline
- Repository: `irpa2412-bit/IRPA-Digital-Board-Governance-System`
- Main rollback source SHA: `352d8b36718a3b88173934c607e6c7834f72a71b`
- Production Worker version ID: `5215bdfd-6b8f-4135-baf3-4b6ec02bcfb3` (verified in successful production Gateway deployment run [44897446474](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44897446474)); live Worker commit: `352d8b36718a3b88173934c607e6c7834f72a71b`.
- Live web build stamp: **NOT RETRIEVED** (live endpoint inaccessible; DNS/network resolution failed).
- Current production Worker version ID: `5215bdfd-6b8f-4135-baf3-4b6ec02bcfb3`; this is the immediate rollback target for the upcoming hotfix deployment. The preceding deployment's older rollback version was `679db4b3-0677-4d45-bd21-19d06700ec1c`.
- This file is the durable phase ledger; update it after every phase with verified evidence only.

## Open PR dependency inventory (checked 2026-11-21)
| PR | State | Head SHA | Mergeability | Next step |
|---|---|---|---|---|
| #826 | Open | `0613dc5f1edf659403b35eb8564c062e23de00c2` | Conflict reported | Rebase on main after phase 2; preserve email-link signing baseline |
| #827 | Open | `c7746ea8fb04273ad2073db6d40be6a7136bcbf8` | Mergeable | Rebase and validate after #826 |
| #815 | Open | `bf524ee21f743c22cbd086a6398a2834737fdd71` | Conflict reported | Rebase after #827 |
| #812 | Open | `1fd017c988ef29a857b29c976bb47d1c8ba7168a` | Conflict reported | Rebase after #815 |
| #813 | Open | `a93db257b5875171a2df0075de60c7032ea3a632` | Mergeable | Compare with #812; retain only still-needed follow-up |
| #793 | Open | `1647e56b7c6697df0f522d5301d7ebfe2c6b63c5` | Mergeable | Resolve duplicate with #789 during signature phase |
| #789 | Open | `188e3c42d48796bd7ba4af7311fdf6f6eb72812d` | Mergeable | Resolve duplicate with #793 during signature phase |
| #830 | Open | `b62e0ea883ba6d697dd2f2c5ac954c72cf033042` | Conflict reported | Rebase after meeting work |

## Historical phase ledger (superseded by the authoritative consolidated phase ledger above)

| Phase | State | PR | Commit SHA | Run link | Next step |
|---|---|---|---|---|---|
| 0 Baseline | PARTIAL — source SHA and PR inventory retrieved; live Worker and web stamp not retrieved | — | `352d8b36718a3b88173934c607e6c7834f72a71b` | — | Capture live Worker version/build stamp before production deployment |
| 1 TRIAL-only Worker deletion hotfix | IMPLEMENTED ON PR BRANCH; BLOCKED — Gateway/meeting suites pass, but signature regression and baseline protection gates fail; no merge | [#844](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/844) | `9494e8157778d17dfa188fcaff804dd9ca475051` | [Gateway + auth](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44944040182); [meeting migration](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44944040207); [signature refresh failures](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44944040323); [signature migration failures](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44944040390); [security baseline](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44944040211) | Resolve baseline signature suite failures within authorized scope or establish they are pre-existing on baseline; capture baseline smoke/full regression evidence; inspect all delete entry points; no production deploy until live rollback version/build stamp retrieved |
| 2 Firestore deploy safeguard | NOT STARTED | — | — | — | Gate rules/indexes deployment to manual workflow_dispatch with explicit DEPLOY confirmation; add push-path CI guard |
| 3 Meeting Portal sequence | NOT STARTED | #826, #827, #815, #812, #813 | — | — | Rebase and merge in required order |
| 4 Access and protection | NOT STARTED | — | — | — | Full-control roles/grants, inventory, TRIAL safeguards, audit, versioning, protected export; rules diff + emulator tests only |
| 5 Dependencies and chain test | NOT STARTED | — | — | — | Repair dependent portals and require role-matrix E2E chain test |
| 6 Rules approval | WAITING FOR USER APPROVAL | — | — | — | Present final rules diff and emulator logs; wait for exact instruction `DEPLOY RULES` |
| 7 Signature adjustments | NOT STARTED | #793/#789/#830 plus new PR | — | — | Resolve overlap, rebase #830, implement requested signature changes |

## Phase 1A implementation notes — urgent Worker deletion hotfix
- `drive-gateway/src/meetingServices.mjs`: new meeting records receive a server-controlled `environment`; only an administrator's explicit `TRIAL` creation intent sets TRIAL; all other values default to REAL.
- Meeting updates ignore the incoming `environment` field, making the value immutable through this route.
- Meeting deletion now requires administrator authorization and exact `environment === "TRIAL"`; missing, invalid and REAL values fail closed.
- Existing deletion audit write is retained in the same Firestore atomic commit as the parent deletion.
- New unit tests cover REAL, missing, invalid, TRIAL, non-admin, creation defaulting and attempted environment mutation. **Tests have not run; no PASS claim.**
- Other delete entry points still require full source inventory before phase 1 can be called complete.

## Approval boundaries
- No Firestore rules have been changed or deployed.
- Do not deploy Firestore rules/indexes until the user explicitly says `DEPLOY RULES` after reviewing the final diff and emulator results.
- Production deployment requires a verified pre-deploy live Worker version and web build stamp to establish rollback.

### Phase 1 CI evidence (first round, head `84fdd861ba3c05b10d362526d8d045360b39b1f4`)
- PASS: PDF E-Signature Tests — [run 44943910246](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44943910246).
- PASS: Authentication and Identity Parity Tests — [run 44943910085](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44943910085).
- PASS: email-signing-contract — [run 44943910060](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44943910060).
- FAIL: Firebase Functions Entrypoint Integrity Test — [run 44943910189](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44943910189). Exact error: `Change Record omits changed files: drive-gateway/src/meetingServices.mjs`. The change record and repair-window scope were amended in the subsequent commit; second CI round is running.
- FAIL: IRPA Security Baseline Gate — [run 44943909992](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44943909992). Same exact portal-protection error above.
- Other jobs were still queued/in progress at the time of inspection; no overall PASS claim.
- Firestore Rules Change Approval CI passed its validation job; no rules were changed or deployed.

### Phase 1 second CI round (head `b2faa9d731bc5e91001c20088cb0ec3da60877bf`; some jobs cancelled after the subsequent status-ledger-only commit)
- PASS: Gateway unit and authentication parity — [run 44944040182](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44944040182). Job completed the focused authentication/identity tests and the complete Gateway regression suite.
- PASS: Meeting Cloudflare Migration Tests — [run 44944040207](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44944040207).
- PASS: Cloudflare E-Signature Runtime Tests — [run 44944040357](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44944040357).
- PASS: Signature security regression — [run 44944040139](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44944040139).
- PASS: PDF E-Signature Tests — [run 44944040209](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44944040209).
- FAIL: Signature Envelope Refresh and Delivery Regression — [run 44944040323](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44944040323). Four failures in `tests/signature-workflow-policy.test.mjs`: duplicate participant identity/repeated-add locking (line 224), authoritative envelope refresh (line 286), signer-row readability/invitation delivery (line 375), and copy/WhatsApp invitation-link actions (line 432).
- FAIL: Signature Portal Migration Build Test — [run 44944040390](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44944040390). Five failures: the four above plus `tests/signature-email-link-unification.test.mjs` registered member/employee assignment serialization (line 13).
- FAIL: IRPA Security Baseline Gate — [run 44944040211](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44944040211). Exact error: `Baseline smoke and full regression must both be recorded as PASS.` The change record still correctly records PENDING; no test evidence was fabricated.
- CANCELLED after branch updates: Firebase Functions Entrypoint Integrity, Release Build, Readability Release Gate, Signature PDF Page Diagnostics, Meeting Invitation Flow, and Communication Website Integration Verification. Their cancelled state is not PASS.
- Firestore Rules Change Approval validation passed, but no Firestore rules changed or deployed.
- The five signature suite failures are outside this Worker-only change and are not modified here. PR #844 remains open and unmerged.
