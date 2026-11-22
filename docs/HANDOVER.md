PR #845 is merged and deployed; the three live deletion-path refusal checks remain unverified.

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
