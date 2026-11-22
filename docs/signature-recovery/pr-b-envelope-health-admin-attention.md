# Follow-up PR B — envelope health badges and administrator Attention list

Status: scope/acceptance contract only. Runtime UI, Worker query, tests, repair window and Change Record are not yet implemented. This file is not evidence of release readiness.

## Purpose

Add an evidence-derived health badge to each envelope row and an administrator Attention list, without changing envelope or signing state.

## Required owner view

- Every envelope row displays exactly one state: Healthy, Needs attention, or Failed.
- State is derived from a read-only, authenticated assessment response, not from signer-row labels alone.
- Do not mark an envelope Healthy merely because all signers show Signed. A non-Completed envelope with failed/missing/unverifiable completion evidence is not Healthy.
- A Completed envelope is Healthy only when the authoritative completion evidence verifies. Unavailable or malformed assessment data must be shown as Needs attention, never silently treated as Healthy.
- The badge is informational and must not expose signing links, tokens, signature images, private addresses or raw evidence payloads.

## Administrator Attention list

- Administrators can view all envelopes requiring attention across owners.
- Each row shows owner display name, document title, age in East Africa Time (EAT), failing stage/code, and a read-only Run assessment action.
- The list must use Worker-enforced administrator authorization. A UI role check is not an authorization boundary.
- Owners must not be able to enumerate or assess other owners' envelopes.

## Prohibited changes

No envelope, signer, signature, field, token, hash, certificate, archive, status or signing audit record may be created, changed, reassigned, deleted, overwritten or recreated. No automatic retry, send, finalisation, repair or completion. No signing rules, link format, sessions, signer identity, field assignment, stamping, PDF/hash/certificate/archive logic, Firestore rules, secrets, environment variables, SMTP settings or branch protection changes.

## Required tests

- Owner-scoped list and assessment: Owner A cannot see or assess Owner B's records; Worker returns 403; signed-out request returns 401; administrator sees all.
- Healthy, Needs attention and Failed states correctly map from verified evidence and failing-stage codes.
- Signed signer rows with non-Completed envelope never produce Healthy without valid completion evidence.
- Malformed, missing, stale and unavailable assessment responses fail closed to Needs attention.
- EAT age formatting and stage/code display are safe and deterministic.
- Admin list excludes healthy envelopes and includes every Failed/Needs attention envelope.
- Read-only snapshots prove no writes to envelope, signer, signature, field, token, hash, certificate, archive or signing audit records.
- Seven-portal smoke, Signature Portal smoke and full regression pass.

## Governance and release gates

Before implementation, obtain a distinct owner-approved 72-hour Signature Portal repair window scoped to exact changed paths. Add a completed Change Record with exact files/effects, baseline and rollback commit verified from production evidence, baseline smoke, Signature Portal smoke, full regression and PR-head run/job IDs. Merge only after branch protection and all required checks pass. Deploy through approved no-secret-sync Worker and frontend workflows, then verify public build stamps and live deployment gates. No deployment or production-data mutation is authorised by this scope document.
