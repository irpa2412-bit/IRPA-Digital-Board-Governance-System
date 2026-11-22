# Signature Portal controlled finalisation retry — Change Record

- **Change ID:** SR-2026-11-23-01
- **Owner instruction:** 2026-11-22T21:49:37Z
- **Affected portal:** Signature Portal only
- **Target envelope:** `IRPA-ENV-2026-11501354`
- **Repair window:** 2026-11-22T18:06:00Z to 2026-11-25T18:06:00Z (72 hours; existing owner-approved window)
- **Baseline / merge starting point:** `3896624f7f6a673794f9ef20614f34603c9b3dd7`
- **Worker rollback reference:** `eb04405e4ec2d64e45d016b6ed3adbc2e8136fbd`
- **Frontend rollback reference:** `eb68a06fdd04454b0e73d2dc9c010eae5519f458`

## One-PR scope

1. Extend the existing finalisation stage recorder so every normal finalisation attempt has a unique attempt ID, a fresh stage map, retained bounded history, and a sanitised PASS/FAILED record for each stage: `READ_ORIGINAL`, `PDF_BUILD`, `HASH`, `ARCHIVE`, `RECIPIENT_COPIES`, `CERTIFICATE`, `PERSIST_COMPLETION_RECORD`, `SYNC_FIREBASE_MIRROR`, and `DISTRIBUTION`.
2. Add an owner/admin-only **Retry finalisation** action. It requires explicit one-attempt confirmation, verifies the signing audit chain and envelope state, blocks if prior cryptographic evidence exists, creates a restricted envelope snapshot backup before execution, permits only one retry per envelope, and enforces three retry reservations per actor per hour.
3. Invoke the existing normal finalisation exactly once. Record a separate chained audit event with actor, time, action, result and failing stage. A failed attempt retains the original signer/signature evidence and reports its stage code. The retry wrapper never assigns `Completed`; only the existing finalisation flow can do so after its required work succeeds.
4. Provide a seven-day **Undo failed retry** action. It is limited to a failed retry and restores the pre-retry status/completion-failure marker while preserving the audit trail and stage diagnostic. A successfully completed document is immutable and cannot be undone by this control.
5. Add **Download evidence report** containing document title/reference, audit-chain result, source hash, signer names, masked email addresses, EAT signing timestamps and each signature stamp's PASS/FAIL result with page and field ID. When all evidence checks pass, include the exact line: `signatures verified; completed PDF not yet generated`. The report excludes signature images, tokens and full email addresses.
6. Keep email distribution independent from completion. `Completed` remains persisted by the normal finalisation flow before the independent distribution step; email delivery failure cannot revert completion.

## Execution hold

**No production envelope has been read, retried, repaired, finalised, reassigned or modified as part of this code change.** Do not invoke the new retry endpoint for the target envelope until the owner supplies the read-only Diagnose finalisation report and separately confirms the one retry. The production envelope must retain its existing signers, signature fields, audit events, source hashes, certificates and archive records.

## Backup and undo boundaries

- The restricted backup excludes signature images, signature-value payloads, tokens, secrets and link/URL fields. Its envelope hash records the source snapshot integrity without copying secret values into the backup.
- Existing signer records and signing evidence are never rewritten by the retry wrapper.
- A pre-existing cryptographic evidence record blocks retry rather than being deleted or replaced.
- Undo is available for seven days after a failed retry only. It does not delete or alter original signer evidence or the audit chain. A successful `Completed` document is immutable.

## Required validation

- Focused Gateway tests: stage recording for every stage; attempt IDs and bounded attempt history; explicit confirmation; owner/admin authorization; backup redaction; exactly one normal finalisation call; one retry per envelope; three-per-hour limit; failure stage code; seven-day failed-retry undo; unchanged signer evidence and valid audit chain.
- Evidence report tests: masked addresses only, EAT timestamps, document reference, hashes, per-stamp page/field PASS, and exact status line.
- Existing Signature Portal lock tests, email-signing contract, Cloudflare E-signature runtime tests, PDF E-signature tests, security regression, readability gate and release build must pass.
- Required checks: **PENDING**.
- Merge: **NOT STARTED**.
- Production deployment: **NOT STARTED**.
- Production envelope mutation: **NONE**.

## Deployment sequence after merge

Use only the existing production workflows explicitly requested by the owner: Gateway no-secret-sync, Firebase deployment and Cloudflare frontend deployment. Do not edit GitHub environments, protection rules, reviewer lists, secrets or permissions. If any deployment job reports waiting for review, provide its run URL and stop that deployment step; do not bypass the gate. Verify the live Worker `/health` commit and both public frontend build stamps before claiming release completion.
