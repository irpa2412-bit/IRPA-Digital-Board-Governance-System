# Meeting Portal implementation status

Updated: 2026-11-21

| Consolidated phase | Inserted workstream | State | PR | Commit SHA | Run link | Next step |
|---|---|---|---|---|---|---|
| 1. Deploy safeguard | — | OPEN; check rerun requested after scanner correction; prior guard failure was a scanner false-positive plus syntax error, both corrected in the latest code | [#843](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/843) | 8fd2452eff62bd573037ac4906a65ab2ce8fe23f | Awaiting GitHub Actions run retrieval | Verify all required checks, especially the production-only trigger guard; merge only when green. |
| — | 1A. Urgent REAL/TRIAL deletion hotfix | NOT STARTED; queued immediately after Phase 1 merge | — | — | — | Restrict meeting deletion and record purge to explicitly TRIAL meetings; missing/invalid environment is REAL; creation-only immutable environment; preserve audit; add requested tests; deploy Worker after green merge. |
| 2. Inventory | — | NOT STARTED | — | — | — | Administrator-only, paginated, read-only inventory with explicit TRIAL, explicit REAL, and missing/invalid-as-REAL classifications. |
| 3. Access | — | NOT STARTED | — | — | — | Central role resolution, role-based Meeting Portal visibility, and logged Administrator grants with optional expiry. |
| 4. Protection | — | NOT STARTED | — | — | — | Complete deletion safeguards, append-only audit, versioned SHA-256 records, protected exports and emulator rules tests; prepare rules diff without publishing. |
| 5. Rules approval | — | WAITING FOR OWNER APPROVAL | — | — | — | Stop here until the exact owner instruction: DEPLOY RULES. No rules publication before approval. |
| 6. Dependencies | — | NOT STARTED | — | — | — | Repair and test all portal handoffs, EAT/quorum, and full chain role-by-role; reconcile PRs #826, #827, #815, #812 and #813 follow-up. |
| 7. Signature adjustments | — | NOT STARTED | — | — | — | Implement cancellation/removal safeguards and responsive fixed action bar without changing signing order, explicit confirmation, email-link rules or signing protocol. |

Safety boundary: no Firestore rules or indexes have been published by this work. Production rules remain blocked unless a manual workflow is dispatched with the exact input DEPLOY, and the separate Phase 5 owner approval is still required.

## 2026-11-22 amendment — isolated portal repair windows

- Owner amendment: retain per-portal window and Change Record selection; all seven registered portals now have distinct files and registered lock-test lists.
- Repair-window duration is exactly 72 hours; CI emits a warning below 12 hours remaining. Break-glass remains limited to 24 hours.
- Owner renewal commands are `APPROVE <PR> <reason>` or `RENEW <portal> <reason>`, posted on a PR by the repository owner. The workflow is scoped to exactly one portal, records the exact comment quote in the portal window, portal Change Record and `docs/approvals.md`, and does not bypass lock tests or baseline/full regression evidence.
- New portals may use `guardMode: "warning"` for seven days from `registeredAt`; the guard emits a warning during that period and blocks missing per-portal controls after expiry. Existing portals remain protected immediately.
- Cross-portal wiring is adapter-only, behind feature flags default OFF and a kill switch; working portal internals and their lock tests remain unchanged.
- The guard now verifies evidence URLs against GitHub Actions API: the referenced job must be completed/successful and its workflow run head SHA must equal the portal baseline commit. Link-shaped strings alone cannot pass.
- Guard-only path-filtered workflow added for policy scripts/tests/docs and the PR template. No runtime deployment or Firestore rules publication is part of this change.


## 2026-11-22 wind-up — deployment rollback references

**Read-only evidence captured:** 04:42 UTC.

- PR #845 final head: `ada73c51f3bade9fd58c7986f9f0193ee5a19287`; merge commit: `57368a8c2ceb418178aa28e5707b02605851dc83`.
- Latest recorded successful production Gateway Worker release: Version ID `1e25f147-e89d-44ba-8f17-80e7e7a75563`, deployed from commit `57368a8c2ceb418178aa28e5707b02605851dc83`. Previous Gateway Worker rollback version: `dd4637ea-0804-4b85-a455-1e691f1f0d72` (run `44897446502`, prior commit `352d8b36718a3b88173934c607e6c7834f72a71b`).
- Latest recorded successful Cloudflare frontend Worker release: Version ID `2a55c255-cb66-4e1e-aa78-9c219a1ab06d`. Previous frontend Worker rollback version: `b2430948-c116-4ba9-b08c-d8e2a6c9bba1`.
- Latest recorded Firebase Hosting build stamp: commit `57368a8c2ceb418178aa28e5707b02605851dc83`, built `2026-11-22T04:23:07Z`. Previous Firebase Hosting rollback build: commit `40c7cfa33a53871a48c8568a5ff3f876f2df5ac5`, built `2026-11-22T04:06:59Z`.
- **Fresh live re-read limitation:** read-only requests to the production Gateway Worker `/health`, frontend Worker `/health`, and Firebase Hosting origin could not resolve DNS in the execution environment at 04:42 UTC. The identifiers above are the latest recorded successful release versions, not newly verified live-at-04:42 values. Re-read live state before any rollback or release decision.
- Live REAL meeting delete refusal: NOT TESTED. Missing-environment-as-REAL: NOT TESTED. Live REAL meeting-record purge refusal: NOT TESTED. The endpoints are potentially destructive and no authenticated read-only probe was available; no destructive request was sent to a real record.
- Firestore rules and indexes were not changed or published.
- Current Firestore rules version: **NOT RETRIEVED**. No Firestore rules or indexes were changed or published in the #845 release; this record does not substitute for querying the Firebase Rules API.

## CI diagnostic — PR #857 protection gate and Functions integrity (2026-11-22)

**Readability/protection gate:** [workflow run #44987305678](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44987305678), job `137100588299`, failed at `node scripts/portal-protection-check.mjs`. Exact runner output: `"ownerApproved": false`, `"reason": "Protection-only maintenance requires the exact quoted approval from the repository owner account."`, changed files `docs/approvals.md` and `docs/implementation-status.md`, followed by `Process completed with exit code 1`.

**Functions integrity:** [workflow run #44987305636](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44987305636), job `137100588224`. `node --check functions/index.js`, `functions/bootstrap.js`, and `functions/authorizationFunctions.js` all completed successfully. `node scripts/verify-functions-entrypoint-integrity.js` also completed successfully and reported the trial-only reset safety markers and retained legacy meeting callables. The subsequent `node scripts/portal-protection-check.mjs` failed with the same `ownerApproved: false` exact-owner-approval message and exit code 1. Thus the Functions job failure was the shared protection gate, not a Functions syntax/entrypoint defect.

**Cause and correction:** the runner did not find the required exact owner-account guard-maintenance approval at the time of those initial attempts. The existing owner-approved guard-core text was subsequently posted verbatim by the owner on [PR #857](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/857#issuecomment-7074491811). Failed jobs were rerun without changing source code or gate logic. Subsequent results are recorded only by GitHub Actions; this report does not manually record a PASS.
