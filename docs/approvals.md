# Owner approvals

This ledger stores exact owner approval quotations and the resulting scoped action. Renewal automation must quote the original comment verbatim in the corresponding portal Change Record and repair-window activity log.

- 2026-11-21T20:23:03Z — Meeting Portal — "APPROVE 845 REAL meetings must never be deleted by anyone; only a meeting explicitly created as TRIAL may be deleted, by an administrator, with safeguards. This is my decision of 21 November 2026. The approval is conditional: merge #845 and deploy it only when every required check on its final head is green and you have investigated and fixed the failed "Enforce protected portal repair policy" step without bypassing it or recording any PASS by hand." — recorded in PR #845 comment 7068716176. Conditional approval only; not a waiver of checks.\n- 2026-11-22 — Meeting Portal concurrency regression — "Approved: update the stale concurrency assertion in tests/meeting-isolation-guard.test.mjs to test the new PR/push grouping contract." — owner approval recorded for PR #845; this authorizes the single assertion replacement only and does not waive any workflow check.\n
- 2026-11-22T04:57:12Z — PR #857 — "APPROVE 857 Docs-only rollback information in docs/implementation-status.md. I, the owner, approve merging #857 when its required checks are green. This approval covers protection and documentation files only, never portal source, Worker routes, Firestore rules or deploy workflows." — owner approval for documentation/protection files only; merge only after all required checks are green. Explicit exclusions: portal source, Worker routes, Firestore rules and deploy workflows. Recorded in PR #857 owner comment.
- 2026-11-22T05:02:09Z — PR #858 — "APPROVE 858, docs only" — owner approval for the Finance and Procurement retention draft, documentation only. Owner comment: https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/858#issuecomment-7074519877.

- 2026-11-22 — Standing approval A (owner quotation): "Docs, verification and protection records only; approved to merge when required checks are green." Scope limited to documentation under docs/*, protection records/window files, and read-only verification workflows. Explicitly excludes portal source, Worker routes, Firestore rules and deploy workflows. Merge only when all required checks are green. Recorded in PR #870 owner comment.


## CI diagnostic — PR #869 (2026-11-22)

- Failing checks: IRPA Security Baseline Gate (run 45004536843, job 137153069183); IRPA-DBGS Readability Release Gate (run 45004536980, job 137153069821); Firebase Functions Entrypoint Integrity Test (run 45004536889, job 137153069515).
- Exact diagnostic lines from all three jobs: `protectedFiles: ["docs/approvals.md"]`; `reason: "Protected changes must be split into one-portal PRs; multi-portal changes are blocked."`
- Cause: PR #869 combined the protected approval ledger (`docs/approvals.md`) with general handover documentation (`docs/HANDOVER.md`). The protection classifier correctly treated the approval ledger as a protected change affecting multiple portal owners; the PR was not a valid guard-only change.
- Repair: split the approval-ledger record into its own single-file PR #872; handover/inventory changes must remain in a separate docs-only PR. No guard condition was weakened.
- Follow-up on PR #872: initial checks ran before the owner approval comment was posted and reported `ownerApproved: false`. The exact prior Guard-core approval is present in the owner account comment #7076820276, alongside the current standing approval A. A fresh run is required to evaluate the approval comment after it exists.


## Owner approval — issue-comment canary trigger (2026-11-22)

Verbatim owner approval:

> I, the owner, approve adding an owner-only comment trigger to the canary job of "Live Meeting REAL Record Protection Verification", so that the canary I authorised ("RUN CANARY") can start without the manual button, and approve merging that PR when its required checks are green. It covers this one workflow change only, never portal source, Worker routes, Firestore rules or other deploy workflows. Quote my words in the PR from the owner account and in docs/approvals.md (in its own protected PR, as before).

Scope is limited to this one workflow's owner-comment canary trigger and its text-level trigger tests. This is not approval for portal source, Worker routes, Firestore rules, other deploy workflows, or canary execution before the workflow change is merged and independently verified. Merge only when every required check is green.

Dedicated request issue: [#876 — Canary run request](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/issues/876), locked. Workflow must enforce comment action `created`, issue number `876`, owner login `irpa2412-bit`, owner numeric ID `319164319`, and exact body `RUN CANARY`; edited comments must not trigger.
