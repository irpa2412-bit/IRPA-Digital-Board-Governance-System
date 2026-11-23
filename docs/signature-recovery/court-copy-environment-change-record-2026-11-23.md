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

## Additional owner decision — certificate-only read-only retrieval

- **Decision time:** 2026-11-23 10:24:45Z, explicit owner instruction.
- **Applies to:** ENV-4b06e60941f8eb1d only, within the repair window above.
- **Conditional exception:** If and only if the source hash, complete audit chain, all 12 chained field-level stamp hashes, stamp rendering, PDF build and final PDF SHA-256 pass, but certificate-page text extraction or certificate-page verification alone cannot pass in this read-only builder, the system may serve the generated copy.
- **Mandatory label:** UNARCHIVED COPY. Certificate page not verified. Audit chain, source hash and 12 stamps verified. The envelope is NOT Completed.
- The exact label must appear on the recovery screen, in the downloaded PDF filename and as the first line of the downloadable PDF evidence report. The screen and report must show the SHA-256, a Copy hash control, and an explicit PASS, FAILED or NOT APPLICABLE result for every verification check. Signer addresses in the report must be masked and signing times shown in EAT.
- **Fail-closed boundary:** Any source read/hash, audit-chain, stamp evidence/rendering, PDF build, size-limit, timeout or output-hash failure still refuses the copy. A certificate-only exception never changes the envelope status or creates a completion event.
- **No-write condition:** This is a read-only delivery exception only. It does not authorise any envelope, signer, field, signature, audit, hash, certificate, archive, Drive or environment-record write, nor any retry or finalisation.
- **Expiry:** This owner decision lapses immediately when the document is delivered, or at the end of the existing 72-hour repair window, whichever occurs first. It does not create a standing recovery policy.
