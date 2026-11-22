PR #845 is merged and deployed; the three live deletion-path refusal checks remain unverified.

## FIRST TASK NEXT SESSION — retention lock and controlled disposal

Create a small, separate implementation PR based on [the Records Retention and Disposal Policy](policies/records-retention-and-disposal.md). This is the first task; keep it separate from #845 and #855. Do not weaken checks or publish Firestore rules.

1. **Retention calculation and inheritance:** for every REAL meeting, set `retainUntil = proceedings date + 10 calendar years`. For a single-day meeting, use its meeting date; for a multi-day meeting, use the final day of proceedings. Do not use the signing, approval, upload or filing date. Every minute, resolution, vote, attendance record, action and recording of that meeting inherits exactly the same `retainUntil`.
2. **Worker enforcement:** enforce the retention deadline server-side. No actor, role, administrator, request, approval or client route may dispose of a REAL proceedings record before `retainUntil`. An active legal hold blocks disposal even after the retention period expires.
3. **Signature Portal disposal workflow:** build on the existing signature portal and authorisation matrix, in this exact order: disposal request with identified records, reason and legal-hold flag; authorisation document reviewed and duly signed by the Director of Internal Oversight; subsequent authorisation by the Executive Director; then execution by an administrator. The administrator executes only and cannot decide relevance or authorise disposal.
4. **No direct deletion:** remove/omit every deletion button and direct deletion path for REAL proceedings records. Preserve administrator deletion for explicitly TRIAL meetings subject to existing safeguards; missing, invalid or ambiguous environment remains REAL.
5. **Permanent audit:** every disposal produces a permanent audit entry containing the document's SHA-256 hash, identifiers, proceedings date, `retainUntil`, reason, legal-hold state, request and authorisation evidence, approvers, executor and timestamp.
6. **Role-register check before implementation assumptions:** inspect the authoritative member register for the exact roles Director of Internal Oversight and Executive Director; report presence and occupancy of each. Do not substitute Director of International Oversight for Director of Internal Oversight. If either role is missing, report it without inventing a holder.
7. **Acceptance evidence:** tests must cover multi-day final-day calculation, identical inherited retention dates, Worker refusal for all actors/routes before the deadline, legal holds, approval sequence and separation of duties, absence of direct REAL deletion, preserved TRIAL safeguards, and permanent SHA-256 disposal audit. Report only actual GitHub check evidence; do not manually mark PASS.

The live member-register read and live deletion-path probes were not available in the 22 November wind-up. Keep those items explicitly NOT VERIFIED until safe, authoritative evidence is obtained.


## Confirmed governance terminology

- The owner has confirmed the correct role title is **Director of Internal Oversight**. It is distinct from Director of International Oversight; do not substitute one for the other. This supersedes the former role-title open decision.
- Grant approval belongs to the Executive Director. The Board has no grant-approval role.
- Full Meeting Portal control without deletion belongs to the Board Secretary, Chairperson, Executive Director, Departmental Heads, Administrator, IT Specialist, Communication and Media personnel, HR and anyone granted it by an Administrator (optional end date, logged). Each profile owner may upload documents to their meetings and sign assigned documents within the document owner's signing order. The Director of Internal Oversight has read-only oversight of proceedings, audit trail, risk register, comments and flags, plus signing of disposal authorisations, unless the owner later decides otherwise.
- Signing order, explicit Confirm, email-link rules and signing protocol are protected and must not change without owner approval.
- Working portals change only when necessary and with owner approval. New integrations use adapters behind feature flags default OFF with a kill switch. Guards begin in warning mode and have defined exits. No crawler or crawler-schedule changes are authorised by this rebuild sequence.


# IRPA-DBGS handover — 22 November 2026

## Live and verified
- Production Gateway Worker deployed from commit 57368a8c2ceb418178aa28e5707b02605851dc83. Cloudflare Version ID: 1e25f147-e89d-44ba-8f17-80e7e7a75563. Its deployment workflow confirmed HTTP 200 from /health and the exact commit.
- Cloudflare frontend Worker deployed from the same commit. Version ID: 2a55c255-cb66-4e1e-aa78-9c219a1ab06d. Live HTML identified the exact commit and all 8 emitted assets matched the build.
- Firebase Hosting live build stamp: commit 57368a8c2ceb418178aa28e5707b02605851dc83; built 2026-11-22T04:23:07Z. The live index and every JavaScript asset matched the build.
- PR #845 is merged and deployed through those workflows. The Worker release health check is green. However, the three requested live deletion-path probes were NOT RUN: the delete and PURGE endpoints perform irreversible writes and do not expose a read-only mode. No authenticated safe canary/probe was available. Do not describe those live refusal checks as passed. The PR and Gateway test suites passed their corresponding code-level tests.
- Firestore rules and indexes were unchanged; the deployment workflow explicitly skipped their deployment. No rules were published. No scheduled workflow or crawler schedule was changed.

## Merged and deployed
- PR #853 — portal-protection guard and repair-window controls. Merge commit: 61fe8f360021bea5692f06c99d7ce5cc770a58ae.
- PR #851 — exact manual DEPLOY RULES confirmation for Firestore publishers and removal of push-triggered staging rules publication. Merge commit: 40c7cfa33a53871a48c8568a5ff3f876f2df5ac5.
- PR #845 — Meeting REAL/TRIAL deletion protection. Merge commit: 57368a8c2ceb418178aa28e5707b02605851dc83. Worker and web release workflows completed successfully.

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

## First three tasks next session
1. Add or use a safe, authenticated, read-only production probe for REAL meeting delete refusal, missing-environment-as-REAL classification, and REAL meeting-record purge refusal. Do not issue a destructive delete or PURGE request against a real record.
2. Complete Meeting roles and grants, then member upload/signing, with separate scope, tests and approvals. Keep the three live deletion checks clearly marked unverified until safe evidence exists.
3. Create the fresh owner-only RENEW workflow PR: validate repository owner comment author ID and github.actor, pass comment body through an environment variable with strict validation, renew exactly one portal by 72 hours, and test wrong-named/stale evidence. Keep all parked work separate.

## Verified PR status snapshot — 22 November 2026, 08:19 UTC request

The following PR state and head workflow results were retrieved from GitHub. PR state is authoritative for merged/open status; a populated `merge_commit_sha` field on an OPEN PR does not make it merged. Workflow checks are reported from the PR head, not inferred from merge metadata.

| PR | GitHub state | Verified result / qualification |
|---|---|---|
| #843 | MERGED | Merge commit `5fa8d46deeeb96c3172a1798411c18f57991855d`. |
| #853 | MERGED | Merge commit `61fe8f360021bea5692f06c99d7ce5cc770a58ae`. |
| #851 | MERGED | Merge commit `40c7cfa33a53871a48aa28e5707b02605851dc83`. |
| #845 | MERGED | Merge commit `57368a8c2ceb418178aa28e5707b02605851dc83`; last recorded release evidence is above. Live refusal probes remain NOT VERIFIED. |
| #846 | MERGED | Merge commit `7f285df5437f96a58e4fcf9e7d2a85b8a9ee112c`. |
| #855 | MERGED | Merge commit `368b9781dca0817daed082720ecfdffe908ddd82`. |
| #588 | MERGED | Merge commit `8f65e2a38bb4e2ad6ef9e5f32dc0570d61ef196a`. |
| #591 | MERGED | Merge commit `3a0d6d21d610a5fc729daeb063ebeda16d62fa1c`. |
| #592 | MERGED | Merge commit `fe4e3de45c718e5c0aa7df8cb46a6f800a9c873f`. |
| #578 | MERGED | Merge commit `ffe701e93665b63e6f4a6ee32fb643adee795bca`. |
| #579 | MERGED | Merge commit `f72efc45820d3e399151ff9bff252a47528ed892`. |
| #857 | MERGED | Merge commit `af787e71492930ad28a31e278c02d13dc8c68778`; all retrieved required head checks succeeded. |
| #858 | MERGED | Merge commit `c4c5abc05e0b8f11b61ad5e993b36fed274f7f7b`; all retrieved required head checks succeeded; docs-only Finance/Procurement draft. |
| #859 | MERGED | Merge commit `824e08582841d511948dfbe5a5a8786352d4aebd`; all retrieved required head checks succeeded. Owner's later title confirmation supersedes any open-decision wording. |
| #863 | OPEN | Four relevant failures on head `c276e350365e1147d0e65766de1e523ade5c3db9`: Firestore Rules Change Approval; Staging Administrator Access Preservation Emulator Gate; Organisational Structure and Signature Matrix Validation; Meeting Portal Isolated Browser Regression. Staging Gateway E2E and Deploy was SKIPPED and is explicitly out of scope per owner instruction. Park and split; no rules publication. |
| #585 | MERGED | Merge commit `7778e95b81b19b8d06c18090abae17646c73da86`; SRS/wireframes is not open. |
| #593 | OPEN | Fundraising Responsive Browser Smoke failed on head `b44451fda38d8b57998e1b9ccb2a6cc384ca3b0d`; other retrieved checks succeeded. |
| #826 | OPEN | No PR-triggered workflow runs were returned for head `0613dc5f1edf659403b35eb8564c062e23de00c2`; checks/status require further retrieval. |
| #827 | OPEN, DRAFT | Multiple failures: Functions integrity, release-readability, Meeting Invitation Flow, security baseline and Meeting Portal isolated browser. Staging Gateway job skipped and ignored as instructed. |
| #815 | OPEN | Multiple failures: release-readability, Firebase-free migration, Meeting Portal isolated browser, Functions integrity, security baseline and organisational/signature matrix validation. |
| #812 | OPEN | Multiple failures: Meeting Portal isolated browser, Firebase-free migration, release-readability, security baseline, organisational/signature matrix and Functions integrity. |
| #813 | OPEN | Multiple failures: security baseline, Functions integrity, release-readability and Meeting Portal isolated browser. Do not treat its populated merge-commit metadata as merged. |
| #793 | OPEN | Multiple failures: security baseline, release-readability, Functions integrity and Signature Palette Visibility/Full Regression. |
| #789 | OPEN | Signature Palette Visibility/Full Regression failed; other retrieved checks succeeded. Do not treat its populated merge-commit metadata as merged. |
| #830 | OPEN | All retrieved head checks succeeded. Not merged; retain its place in the signature dependency sequence. |

### Corrected next-step order from the owner's 22 November instruction

1. **Housekeeping:** #857, #858 and #859 are already merged; #858 and #859 were not pending. Do not repeat their merges. Verify/clear only superseded queued runs (never deployments or latest-head runs), then create a guard-only PR for concurrency and path filters. Do not touch crawler schedules or the unrelated staging WordPress/cPanel workflow.
2. **#845 live proof:** add/run a read-only GitHub Actions workflow for current Gateway Worker versions, frontend Worker version, Firebase Hosting build stamp and Firestore rules version if readable. The previous version/build identifiers in this handover are historical deployment evidence, not a fresh live read. Do not run the destructive canary until the owner posts the exact phrase `RUN CANARY`.
3. **#863 preparation:** split into one-portal PRs: first a rules-only PR for Director of Internal Oversight read-only oversight using verified role assignment; volunteer access separately with least privilege and an end date. Diagnose and fix the backup/rollback test at its cause and add rollback documentation. Stop for the owner's `APPROVE 863 <reason>` and, separately, `DEPLOY RULES`. Never add the approval label or publish rules on the owner's behalf.

## Owner's explicit final decisions — 22 November 2026

- Real meeting records are never deleted. Only explicitly `TRIAL` meetings may be deleted by an administrator with safeguards; missing, invalid or ambiguous environment means `REAL`.
- Proceedings are retained at least ten years from the proceedings day; multi-day proceedings use the final day. All associated proceedings records inherit the same `retainUntil`. Disposal of irrelevant documents requires the Director of Internal Oversight to review and sign the authorisation document before the Executive Director authorises; an administrator executes only and does not decide. Finance/procurement retention duration remains an open owner decision.
- Full Meeting Portal control without deletion is assigned to the roles and persons described under Confirmed governance terminology above; individual profile owners upload to their meetings and sign only assigned documents in the document owner's signing order. Director of Internal Oversight remains read-only oversight, except signing disposal authorisations.
- Grant approval is the Executive Director's authority; the Board has no role in grant approval.
- Repair windows are 72 hours per portal, with a low-time warning at 12 hours. Renewal requires the owner's exact `RENEW <portal> <reason>` phrase. Other owner phrases: `APPROVE <PR> <reason>`, `DEPLOY RULES`, `BREAK GLASS <reason>`, `RUN CANARY`.
- No Firestore rules have been published as part of this verification. No crawler or crawler-schedule changes are authorised. No approval label may be added by the assistant.