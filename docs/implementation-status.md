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
