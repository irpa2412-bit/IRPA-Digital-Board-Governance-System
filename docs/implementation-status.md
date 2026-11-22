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


## 2026-11-22 wind-up execution record

- PR #853 merged: head 9cefa813a7c48d84f72561cbc56221af4f07a1e0; merge commit 61fe8f360021bea5692f06c99d7ce5cc770a58ae. Protection-only; no portal source, Worker route, Firestore rule or deploy workflow changed.
- PR #851 merged after checks on its rebased head 17b35a8d7dbad6660b1ea394fece6d87403f4594; merge commit 40c7cfa33a53871a48c8568a5ff3f876f2df5ac5. Exact DEPLOY RULES confirmation is required; no Firestore rules were published.
- PR #845 merged: head ada73c51f3bade9fd58c7986f9f0193ee5a19287; merge commit 57368a8c2ceb418178aa28e5707b02605851dc83. Fresh required checks on the final head passed, including the Meeting isolated browser workflow's baseline smoke, full regression and isolated browser jobs.
- Production Gateway Worker deployment succeeded: Cloudflare Version ID 1e25f147-e89d-44ba-8f17-80e7e7a75563; run 44984776004; live /health returned HTTP 200 and exact commit 57368a8c2ceb418178aa28e5707b02605851dc83.
- Cloudflare frontend Worker deployment succeeded: Version ID 2a55c255-cb66-4e1e-aa78-9c219a1ab06d; run 44984775923; live HTML matched the exact commit and all 8 assets matched.
- Firebase Hosting deployment succeeded: run 44984775955; live build stamp commit 57368a8c2ceb418178aa28e5707b02605851dc83, built 2026-11-22T04:23:07Z; live index and every JavaScript asset matched.
- Firestore rules and indexes were unchanged; the workflow explicitly skipped rules deployment. No rules were published. No Functions, administrator bootstrap, claims sync, or signer-profile migration ran.
- REAL meeting delete refusal: NOT TESTED live. Missing environment treated as REAL: NOT TESTED live. REAL meeting-record purge refusal: NOT TESTED live. These endpoints are destructive and no read-only live probe was available; corresponding code-level tests passed in the final PR/Gateway test runs. Do not claim live refusal verification.
- Rollback identifiers: previous Gateway Worker Version ID dd4637ea-0804-4b85-a455-1e691f1f0d72 (run 44897446502, prior commit 352d8b36718a3b88173934c607e6c7834f72a71b); previous Cloudflare frontend Worker Version ID b2430948-c116-4ba9-b08c-d8e2a6c9bba1; previous Firebase Hosting build stamp 40c7cfa33a53871a48c8568a5ff3f876f2df5ac5, built 2026-11-22T04:06:59Z. Current Firestore rules version NOT RETRIEVED; unchanged.
- No scheduled workflow or crawler schedule was changed. See docs/HANDOVER.md for parked work and next-session tasks.
