# IRPA-DBGS implementation status

Last updated: 2026-11-21T19:59Z

## Baseline
- Repository: `irpa2412-bit/IRPA-Digital-Board-Governance-System`
- Main rollback source SHA: `352d8b36718a3b88173934c607e6c7834f72a71b`
- Production Worker version: **NOT RETRIEVED** (live health endpoint inaccessible from execution environment; DNS/network resolution failed).
- Live web build stamp: **NOT RETRIEVED** (live endpoint inaccessible; DNS/network resolution failed).
- Production rollback point: **NOT VERIFIED**. Do not deploy production Worker until live version/build stamp is captured.
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

## Phase ledger

| Phase | State | PR | Commit SHA | Run link | Next step |
|---|---|---|---|---|---|
| 0 Baseline | PARTIAL — source SHA and PR inventory retrieved; live Worker and web stamp not retrieved | — | `352d8b36718a3b88173934c607e6c7834f72a71b` | — | Capture live Worker version/build stamp before production deployment |
| 1 TRIAL-only Worker deletion hotfix | IMPLEMENTED ON BRANCH; tests authored, NOT RUN | Pending | `cd5297800e04440d0835adc4563bb874529339fe` | NOT AVAILABLE YET | Open PR; run Worker tests; inspect every delete entry point; merge only when all checks green |
| 2 Firestore deploy safeguard | NOT STARTED | — | — | — | Gate rules/indexes deployment to manual workflow_dispatch with explicit DEPLOY confirmation; add push-path CI guard |
| 3 Meeting Portal sequence | NOT STARTED | #826, #827, #815, #812, #813 | — | — | Rebase and merge in required order |
| 4 Access and protection | NOT STARTED | — | — | — | Full-control roles/grants, inventory, TRIAL safeguards, audit, versioning, protected export; rules diff + emulator tests only |
| 5 Dependencies and chain test | NOT STARTED | — | — | — | Repair dependent portals and require role-matrix E2E chain test |
| 6 Rules approval | WAITING FOR USER APPROVAL | — | — | — | Present final rules diff and emulator logs; wait for exact instruction `DEPLOY RULES` |
| 7 Signature adjustments | NOT STARTED | #793/#789/#830 plus new PR | — | — | Resolve overlap, rebase #830, implement requested signature changes |

## Phase 1 implementation notes
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
