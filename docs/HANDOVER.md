PR #845 is merged and deployed; the three live deletion-path refusal checks remain unverified.

## Queued work after the current rebuild sequence — retention lock and controlled disposal

Create a small, separate implementation PR based on [the Records Retention and Disposal Policy](policies/records-retention-and-disposal.md) after the currently approved sequence (documentation reconciliation, #845 read-only proof, and #863 access split) is complete. Keep it separate from #845 and #855. Do not weaken checks or publish Firestore rules.

1. **Retention calculation and inheritance:** for every REAL meeting, set `retainUntil = proceedings date + 10 calendar years`. For a single-day meeting, use its meeting date; for a multi-day meeting, use the final day of proceedings. Do not use the signing, approval, upload or filing date. Every minute, resolution, vote, attendance record, action and recording of that meeting inherits exactly the same `retainUntil`.
2. **Worker enforcement:** enforce the retention deadline server-side. No actor, role, administrator, request, approval or client route may dispose of a REAL proceedings record before `retainUntil`. An active legal hold blocks disposal even after the retention period expires.
3. **Signature Portal disposal workflow:** build on the existing signature portal and authorisation matrix, in this exact order: disposal request with identified records, reason and legal-hold flag; authorisation document reviewed and duly signed by the Director of Internal Oversight; subsequent authorisation by the Executive Director; then execution by an administrator. The administrator executes only and cannot decide relevance or authorise disposal.
4. **No direct deletion:** remove/omit every deletion button and direct deletion path for REAL proceedings records. Preserve administrator deletion for explicitly TRIAL meetings subject to existing safeguards; missing, invalid or ambiguous environment remains REAL.
5. **Permanent audit:** every disposal produces a permanent audit entry containing the document's SHA-256 hash, identifiers, proceedings date, `retainUntil`, reason, legal-hold state, request and authorisation evidence, approvers, executor and timestamp.
6. **Role-register check before implementation assumptions:** inspect the authoritative member register for the exact roles Director of Internal Oversight and Executive Director; report presence and occupancy of each. Do not substitute Director of International Oversight for Director of Internal Oversight. If either role is missing, report it without inventing a holder.
7. **Acceptance evidence:** tests must cover multi-day final-day calculation, identical inherited retention dates, Worker refusal for all actors/routes before the deadline, legal holds, approval sequence and separation of duties, absence of direct REAL deletion, preserved TRIAL safeguards, and permanent SHA-256 disposal audit. Report only actual GitHub check evidence; do not manually mark PASS.

The live member-register read and live deletion-path probes were not available in the 22 November wind-up. Keep those items explicitly NOT VERIFIED until safe, authoritative evidence is obtained.


## Resolved owner decisions

- **Role title:** Director of Internal Oversight. The owner has settled this title; it is not an open decision. Do not substitute “Director of International Oversight”.


# IRPA-DBGS handover — 22 November 2026

## Live and verified
- Production Gateway Worker deployed from commit 57368a8c2ceb418178aa28e5707b02605851dc83. Cloudflare Version ID: 1e25f147-e89d-44ba-8f17-80e7e7a75563. Its deployment workflow confirmed HTTP 200 from /health and the exact commit.
- Cloudflare frontend Worker deployed from the same commit. Version ID: 2a55c255-cb66-4e1e-aa78-9c219a1ab06d. Live HTML identified the exact commit and all 8 emitted assets matched the build.
- Firebase Hosting live build stamp: commit 57368a8c2ceb418178aa28e5707b02605851dc83; built 2026-11-22T04:23:07Z. The live index and every JavaScript asset matched the build.
- PR #845 is merged and deployed through those workflows. The Worker release health check is green. However, the three requested live deletion-path probes were NOT RUN: the delete and PURGE endpoints perform irreversible writes and do not expose a read-only mode. No authenticated safe canary/probe was available. Do not describe those live refusal checks as passed. The PR and Gateway test suites passed their corresponding code-level tests.
- Firestore rules and indexes were unchanged; the deployment workflow explicitly skipped their deployment. No rules were published. No scheduled workflow or crawler schedule was changed.

## Verified merged PRs — GitHub state checked 22 November 2026
- #843 — 5fa8d46deeeb96c3172a1798411c18f57991855d.
- #853 — 61fe8f360021bea5692f06c99d7ce5cc770a58ae.
- #851 — 40c7cfa33a53871a48c8568a5ff3f876f2df5ac5.
- #845 — 57368a8c2ceb418178aa28e5707b02605851dc83.
- #846 — 7f285df5437f96a58e4fcf9e7d2a85b8a9ee112c.
- #855 — 368b9781dca0817daed082720ecfdffe908ddd82.
- #588 — 8f65e2a38bb4e2ad6ef9e5f32dc0570d61ef196a.
- #591 — 3a0d6d21d610a5fc729daeb063ebeda16d62fa1c.
- #592 — fe4e3de45c718e5c0aa7df8cb46a6f800a9c873f.
- #578 — ffe701e93665b63e6f4a6ee32fb643adee795bca.
- #579 — f72efc45820d3e399151ff9bff252a47528ed892.
- #857 — af787e71492930ad28a31e278c02d13dc8c68778.
- #858 — c4c5abc05e0b8f11b61ad5e993b36fed274f7f7b.
- #859 — 824e08582841d511948dfbe5a5a8786352d4aebd.
- #585 — 7778e95b81b19b8d06c18090abae17646c73da86.

## Verified open PRs — GitHub state checked 22 November 2026
- #863 (head c276e350365e1147d0e65766de1e523ade5c3db9); four required gates failing. Staging Gateway E2E/Deploy is skipped and is not counted as a failure.
- #593, #826, #827, #815, #812, #813, #793, #789 and #830 remain open. A non-null merge_commit_sha in stale metadata does not override state=open and merged=false.
- PR checks are commit-specific. Do not infer current branch or production state from a prior run.

## Current work order
1. Reconcile this handover and implementation-status record; no runtime or rules change.
2. Run fresh read-only production proof for #845 through GitHub Actions. Report Worker versions, frontend/web build stamp and Firestore rules version if readable. Prepare but do not dispatch the destructive canary until the owner posts exactly RUN CANARY.
3. Split #863 into separate portal-scoped PRs, diagnose each failed gate at its cause, and prepare rollback evidence. Stop before merge/publication at the exact owner boundaries APPROVE 863 ... and DEPLOY RULES.

## Not done — parked
- Renewal workflow hardening and a fresh renewal PR.
- Firestore rules deployment (no rules published).
- Signature adjustments.
- Meeting roles and grants.
- Member upload and signing.
- Authorisation portal.
- Communication and Media feature work.
- Finance and Procurement review.

### Finance and Procurement retention-policy review task

Review the draft section [Finance and Procurement records](policies/records-retention-and-disposal.md#8-finance-and-procurement-records-draft-to-be-confirmed) with the owner and the person responsible for finance/procurement compliance. The proposed rules are explicitly DRAFT and must not be treated as confirmed or implemented. Determine the applicable retention period only after checking donor agreements and Tanzanian legal requirements; report the evidence and leave the duration as an open owner decision.

As part of that review, inventory **every delete/disposal path** in both portals and report which paths would break the proposed draft policy. Inspect and list separately:
1. every user-interface deletion control or workflow;
2. every Worker route, including direct/API and alternate route paths; and
3. every applicable Firestore rule or rules-based deletion permission.

For each path, record the portal, exact screen/control or route/rule location, actor/permission, record classifications affected (REAL, TRIAL, missing/invalid/ambiguous), whether it can delete or bypass approval/audit, and the evidence supporting the finding. Identify explicitly which paths would permit deletion of a real financial/procurement record, bypass the Director of Internal Oversight review/signature or Executive Director authorisation, delete a non-explicit-TRIAL test record, or omit the permanent SHA-256 audit. Mark unverified paths NOT VERIFIED rather than assuming they are safe.

**Scope boundary:** this is an inventory and policy-review task only. Do not change portal behaviour, Worker code, Firestore rules, permissions, or deployment configuration as part of this review. Any later enforcement work requires a separate, explicitly scoped change and the required approvals/checks.
- Grant analysis features.
- The three live deletion-path refusal checks described above.

## Approval phrases
- APPROVE — explicit owner approval for the named PR and stated scope; conditional checks still must pass.
- RENEW — owner request to extend exactly one named portal repair window by 72 hours; it does not waive tests.
- DEPLOY RULES — exact manual confirmation required by the Firestore rules publishing workflows. No rules deployment is approved by this handover.
- BREAK GLASS — emergency protection action, limited to the separately defined 24-hour break-glass window and its recorded controls.

## Rollback versions
- Previous production Gateway Worker Version ID: dd4637ea-0804-4b85-a455-1e691f1f0d72 (previous deployment run 44897446502, commit 352d8b36718a3b88173934c607e6c7834f72a71b).
- Current production Gateway Worker Version ID: 1e25f147-e89d-44ba-8f17-80e7e7a75563.
- Previous Cloudflare frontend Worker Version ID: b2430948-c116-4ba9-b08c-d8e2a6c9bba1.
- Previous Firebase Hosting build stamp: commit 40c7cfa33a53871a48c8568a5ff3f876f2df5ac5; built 2026-11-22T04:06:59Z.
- Current Firebase Hosting build stamp: commit 57368a8c2ceb418178aa28e5707b02605851dc83; built 2026-11-22T04:23:07Z.
- Current Firestore rules version: NOT RETRIEVED; rules were unchanged and not published in this wind-up.

## Next tasks after this handover
1. Complete the documentation reconciliation PRs #867 and #868 only after their required checks and exact protection approval are satisfied.
2. Run the fresh read-only #845 production proof through GitHub Actions. Prepare, but do not run, the canary until the owner writes exactly RUN CANARY.
3. Split #863 into one-portal PRs, diagnose and repair the failing gates at their causes, and prepare rollback evidence. Stop at APPROVE 863 ... and DEPLOY RULES.

Do not treat skipped staging WordPress/cPanel jobs as failures for this rebuild. Do not publish Firestore rules.


## 2026-11-22 — TASK 2B owner-comment canary trigger status

- Dedicated issue [#876 — Canary run request](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/issues/876) was created and locked. The canary job gate is designed to require a newly-created issue comment, issue number 876, owner login `irpa2412-bit`, numeric owner ID `319164319`, and exact body `RUN CANARY`. Edited comments are excluded by the event type and the authorization helper. The comment body is read from the GitHub event payload by a Node guard; it is not interpolated into shell commands or workflow expressions.
- Owner's specific workflow approval was quoted verbatim in PR #877 and PR #878. PR #877 is the separate protected `docs/approvals.md` ledger PR. It initially failed because the protection guard requires the already owner-approved Guard-core (#853) quotation; that prior owner quote has now been posted on #877 and the failed jobs were rerun. Latest check state is still pending at this handover.
- Workflow implementation PR [#878](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/878), head `7b223ee1968c8d44ed6b56bce1272d815eb39275`. The workflow validation and owner-comment text tests passed in run [#45006799489](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/45006799489). Other required checks were still running at this handover; PR is not merged.
- The canary job remains excluded from `workflow_run` and `schedule`. It performs a fresh read-only preflight inside the canary job, and only then runs the canary script. Job-level concurrency is serial and does not cancel an active canary. The old Gateway version `dd4637ea-0804-4b85-a455-1e691f1f0d72` is pre-#845, unsafe, do not roll back to it; rollback deployment logic and the associated read-only rollback-version dependency were removed from this workflow path.
- Canary script reuses a single labelled canary meeting and linked record rather than creating duplicates; it records final read-back checks. No canary was run, no comment `RUN CANARY` was posted on issue #876, no meeting ID exists, and delete/purge/environment mutation checks remain NOT TESTED.
- PR [#875](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/875) was narrowed to `docs/implementation-status.md` only; `docs/HANDOVER.md` was removed from that PR to avoid the isolated Meeting Portal browser scope guard. The owner-approved Guard-core (#853) classification quotation was posted on #875. Required checks are still running; do not merge until all required checks are green.
- PR [#877](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/877) remains the separate approval-ledger PR. Do not merge it until every required check is green.
- No Worker route, portal source, Firestore rule, or deployment workflow was changed. No Worker deployment, canary record creation, rollback, or Firestore rules publication occurred.

## 2026-11-22 — TASK 2B status correction after merge

- PR #875 (baseline implementation-status documentation) merged. PR #877 (owner approval ledger) merged. PR #878 (owner-comment canary trigger workflow) merged at `b69d4f06fc7b2d6a125cb8633091814d9f4d8750`.
- Post-merge workflow run [#45007437491](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/45007437491): owner-comment authorization tests and syntax checks PASS; live canary job SKIPPED; read-only production job SKIPPED. Therefore no live production protection checks were executed.
- Dedicated issue #876 was initially locked, preventing the required owner comment. The conversation has now been unlocked. It currently has zero comments. The canary remains NOT RUN; no meeting or record was created; delete refusal, purge refusal, environment mutation refusal, and final read-back remain NOT TESTED.
- The trigger requires a newly created comment authored by repository owner login `irpa2412-bit`, numeric ID `319164319`, exact body `RUN CANARY`, on issue #876. The owner must post that exact comment while signed in to the owner account. The GitHub integration must not impersonate the owner.
- The prior Handover PR #879 used a synthetic merge commit without a common merge base; its `portal-protection-check` failed with `fatal: origin/main...HEAD: no merge base`. Do not repeat synthetic merge commits. This correction is committed from the current main branch in a normal docs-only PR.
- No portal source, Worker route, Firestore rule, or production deployment was changed. No Firestore rules were published. The pre-#845 Gateway version `dd4637ea-0804-4b85-a455-1e691f1f0d72` remains unsafe and must not be used as rollback.

## 2026-11-22 — TASK 2B final live canary evidence

- Workflow trigger repair PR #882 merged as `b96bb4a5238db11bf7020aa65c700e9ac1b77876`. It limits job startup to new comments on issue #876 and delegates all author ID, owner login, exact body, action, issue type and pull-request exclusion checks to the payload guard before any production preflight.
- Canary preflight history fix PR #883 merged as `9222993b2e623ad742e6fa6d124c5739d333c149`. The canary checkout now uses `fetch-depth: 0`; the live build ancestry gate remains enabled.
- Owner posted exact `RUN CANARY` on issue #876 after both fixes merged. The successful run is [#45008598993](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/45008598993).
- **Live canary results: PASS.** Fresh production preflight and approved admin credential path were available. Gateway Worker active version `aa5e131b-752e-4b30-b2f9-d28907d3eee7`; Gateway /health commit `57368a8c2ceb418178aa28e5707b02605851dc83`. Frontend Worker active version `d50bcca3-3615-4a32-a91c-d4fde6971dbb`; frontend health HTTP 200. Firebase Hosting build `b96bb4a5238db11bf7020aa65c700e9ac1b77876`, build time `2026-11-22T09:36:44Z`. Firestore ruleset `00ebeb44-e151-415c-9616-b94c215c2589`.
- REAL meeting delete refusal: **PASS**, HTTP 409. REAL meeting-record purge refusal: **PASS**, HTTP 409. Attempt to set environment to TRIAL: **PASS**, no TRIAL value persisted (response HTTP 200; persisted environment remained absent). The successful canary script additionally requires missing environment retained, final meeting exists, final record exists, and final environment unchanged; the job completed successfully.
- The canary script wrote the meeting ID and record ID to step outputs and the GitHub job summary, but those IDs were not present in the retrieved job-log API response: identifiers remain **NOT RETRIEVED** in this handover. Use the job summary in run #45008598993 for those identifiers.
- No Worker route, portal source, Firestore rule, or application deployment was changed by TASK 2B. No Firestore rules were published. The canary verified the already deployed production state; it did not deploy new runtime code. The pre-#845 Gateway version `dd4637ea-0804-4b85-a455-1e691f1f0d72` remains unsafe and must not be used as rollback.
