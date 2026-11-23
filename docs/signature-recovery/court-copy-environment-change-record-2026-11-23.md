# Court document preserved-copy recovery — Change Record

- **Change ID:** SR-COURT-2026-11-23-01
- **Owner authorisation:** Explicit owner instruction in the 2026-11-23 conversation; limited to envelope `ENV-4b06e60941f8eb1d` / document `IRPA-ENV-2026-11501354` and this recovery fix.
- **Repair window:** 2026-11-23 09:55:33Z through 2026-11-26 09:55:33Z (72 hours), or earlier on delivery of the document.
- **Baseline:** `main` at PR #927 merge commit `19c05b331d361f7b3af17dfc5ac29809210a63dc`.
- **Scope:** Read-only preserved-copy retrieval and recovery-screen download actions only.

## Approved changes

1. Validate the preserved-copy environment against the envelope's recorded data environment. The current Worker `IRPA_ENVIRONMENT` must not select or reject the preserved artifact.
2. Read the recorded preserved storage ID without moving, copying, deleting or writing any environment record.
3. Verify the retrieved bytes against both the preserved-copy SHA-256 and the envelope completion SHA-256. Serve the preserved bytes only on a double match.
4. Classify missing, unreadable, environment-mismatched and hash-mismatched preserved artifacts with short codes, then call the existing read-only `buildEmergencyRetrieval` builder.
5. Add an owner-facing direct emergency-retrieval download action, output SHA-256 verification, copy-hash control, source indicator and the label “Unarchived copy; the envelope is not yet Completed”.

## Required verification

- TRIAL preserved copy is retrievable when the current Worker switch is ACTUAL.
- Missing, environment-mismatched and hash-mismatched preserved copy paths fall back to the existing emergency builder.
- Repeated requests under different current Worker environment values do not change the preserved-copy result.
- Owner/admin access only; non-owner receives 403.
- Downloaded bytes equal the displayed SHA-256.
- No writes to envelope, signer, signature, audit, hash, certificate, archive, Drive or other environment records.

## Immutable boundaries

No changes to signing rules, tokens, link format, sessions, signer identity, field assignment, PDF building, hashing implementation, certificate logic, secrets, environment variables, SMTP settings, Firestore rules, branch protection or production reviewer policy. No production data or artifact is moved, copied or deleted. No envelope or signing evidence is mutated.

## Delivery gates

PR checks required: `security-baseline`, `integrity`, and `Readability Checker and Independent Verifier`. Merge only through normal branch protection. Deployment, if approved by required checks and reviewers, must use the existing no-secret-sync workflow, Firebase Hosting and Cloudflare frontend deployment. Verify Worker health version and frontend build stamp against the merge commit and perform fresh unauthenticated JSON sign-in probes. No deployment is authorised by this Change Record alone.
