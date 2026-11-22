# IRPA-DBGS implementation status

Updated: 2026-11-22 (GitHub-verified reconciliation)

| Workstream | State | Evidence / PR | Next action |
|---|---|---|---|
| Portal protection guard | MERGED | #843 — 5fa8d46deeeb96c3172a1798411c18f57991855d; #853 — 61fe8f360021bea5692f06c99d7ce5cc770a58ae | Preserve per-portal controls and evidence verification. |
| REAL/TRIAL meeting safeguards | MERGED; live behaviour NOT VERIFIED | #845 — 57368a8c2ceb418178aa28e5707b02605851dc83; #855 — 368b9781dca0817daed082720ecfdffe908ddd82 | Fresh read-only production proof; no destructive live probes absent canary approval. |
| Firestore rules publishing protection | MERGED | #851 — 40c7cfa33a53871a48c8568a5ff3f876f2df5ac5 | Do not publish rules without exact DEPLOY RULES. |
| Governance/docs and offline work | MERGED | #846 — 7f285df5437f96a58e4fcf9e7d2a85b8a9ee112c; #578 — ffe701e93665b63e6f4a6ee32fb643adee795bca; #579 — f72efc45820d3e399151ff9bff252a47528ed892; #585 — 7778e95b81b19b8d06c18090abae17646c73da86 | #585 docs baseline merged; do not infer live grant-analysis behaviour. |
| Grants | Core merged; follow-up OPEN | #588 — 8f65e2a38bb4e2ad6ef9e5f32dc0570d61ef196a; #591 — 3a0d6d21d610a5fc729daeb063ebeda16d62fa1c; #592 — fe4e3de45c718e5c0aa7df8cb46a6f800a9c873f; #593 OPEN | Verify live Analyse separately; #593 remains open. |
| Meeting operational access | OPEN / BLOCKED | #863 OPEN, head c276e350365e1147d0e65766de1e523ade5c3db9 | Split into portal-scoped changes; four failing gates require cause-level repair. |
| Signature portal adjustments | OPEN | #826, #793, #789, #830 OPEN | Resolve assigned-field envelope text defect first; then scoped cancellation, cleanup audit and responsive action-bar work. |
| Attendance and quorum | OPEN | #827, #815, #812, #813 OPEN | Resolve individually without bundling portal scope. |
| Finance/procurement retention | DRAFT / OWNER DECISION OPEN | Policy section remains draft | Determine period only after donor and Tanzanian legal review; do not implement a guessed duration. |

## Verified merged PR register (22 November 2026)
| PR | Merge commit |
|---|---|
| #843 | 5fa8d46deeeb96c3172a1798411c18f57991855d |
| #853 | 61fe8f360021bea5692f06c99d7ce5cc770a58ae |
| #851 | 40c7cfa33a53871a48c8568a5ff3f876f2df5ac5 |
| #845 | 57368a8c2ceb418178aa28e5707b02605851dc83 |
| #846 | 7f285df5437f96a58e4fcf9e7d2a85b8a9ee112c |
| #855 | 368b9781dca0817daed082720ecfdffe908ddd82 |
| #588 | 8f65e2a38bb4e2ad6ef9e5f32dc0570d61ef196a |
| #591 | 3a0d6d21d610a5fc729daeb063ebeda16d62fa1c |
| #592 | fe4e3de45c718e5c0aa7df8cb46a6f800a9c873f |
| #578 | ffe701e93665b63e6f4a6ee32fb643adee795bca |
| #579 | f72efc45820d3e399151ff9bff252a47528ed892 |
| #857 | af787e71492930ad28a31e278c02d13dc8c68778 |
| #858 | c4c5abc05e0b8f11b61ad5e993b36fed274f7f7b |
| #859 | 824e08582841d511948dfbe5a5a8786352d4aebd |
| #585 | 7778e95b81b19b8d06c18090abae17646c73da86 |

## Current open PR register (22 November 2026)
- #863 — four failed checks; head c276e350365e1147d0e65766de1e523ade5c3db9.
- #593, #826, #827, #815, #812, #813, #793, #789 and #830 — OPEN.
- Treat state=open and merged=false as authoritative over stale non-null merge_commit_sha metadata.

## #863 failure status
Latest PR-head workflow snapshot: four failures: Firestore Rules Change Approval; Staging Administrator Access Preservation Emulator Gate; Organisational Structure and Signature Matrix Validation; Meeting Portal Isolated Browser Regression. Staging Gateway E2E and Deploy is SKIPPED, not a failing gate. Retrieve exact failing assertions/log causes from the latest run before editing; do not infer causes from job names or weaken checks.

## Production evidence boundary for #845
Previously recorded Worker version IDs and Firebase Hosting build stamp are historical deployment evidence, not a fresh live read. Fresh read-only production proof is pending. Firestore rules version remains NOT RETRIEVED. No Firestore rules or indexes have been published by this work.

## Owner-controlled boundaries
- APPROVE <PR> <reason>: exact owner approval for the named PR and scope; all required checks remain mandatory.
- RENEW <portal> <reason>: renews one portal repair window only; does not waive checks.
- DEPLOY RULES: exact approval required before publishing Firestore rules.
- RUN CANARY: exact approval required before any destructive or state-changing live canary.
- No secret values in logs or chat. No production release without relevant explicit approval.

## 2026-11-22 repair-window and guard policy
- Repair window: 72 hours; warning at 12 hours; break-glass remains 24 hours.
- Cross-portal adapters are feature-flagged OFF with a kill switch.
- New portals may run warning mode for seven days after registration; existing portals are protected immediately.
- Evidence URLs must resolve to completed successful GitHub Actions jobs whose run head SHA matches the portal baseline commit.

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
