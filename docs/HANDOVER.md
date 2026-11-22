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


## Open decisions

- **Role-title confirmation (OPEN DECISION):** the retention policy records the role as "Director of Internal Oversight", while repository records show "Director of International Oversight"; the owner must confirm the correct title before the disposal workflow is built.


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
