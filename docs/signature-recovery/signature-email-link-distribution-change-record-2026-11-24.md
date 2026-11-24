# Signature Email-Link Automatic Distribution Repair

- Change ID: SR-2026-11-24-01
- Baseline: 2d4e39d4394ca84ee2246573a3936711979f53af
- Branch: fix/signature-email-link-auto-distribution-20261124
- Owner authorisation: 2026-11-24T08:11:25Z
- Status: PR #953 merged and deployed; completion-first hardening follow-up under review

## Diagnosis

Read-only inspection of the current main source confirmed:

1. `recipientsFor()` in `drive-gateway/src/signatureDistribution.mjs` keys a map by normalized email. This merges distinct signer IDs that share an email address.
2. The same selector filters signers to `status === "Signed"`, excluding other invited signer positions from the completed-document distribution set.
3. The automatic distribution function makes one attempt per recipient. The separate owner-triggered retry route does not perform automatic transient retries at completion.
4. The completion email adapter in `drive-gateway/src/index.js` does not pass the already-supported SMTP `onStage` callback through to `smtpSend`; therefore per-stage SMTP outcomes are not persisted with the recipient delivery record.
5. Personal-copy creation filters to signed signers, excluding eligible profile holders whose signer position is still pending/optional at envelope completion.

The normal finalisation sequence already persists `Completed` after PDF construction, hash, certificate and archive work, then invokes distribution separately. That order is correct and is preserved. Source inspection does not establish which production SMTP transaction failed; no production delivery logs or live recipient records were read.

## Approved repair

- Use one stable distribution identity for the document owner and one for each envelope signer ID. Never deduplicate delivery by email address.
- Include every invited signer/email-link assignment in the completed envelope, regardless of signer status. Do not add forwarded-link holders as recipients.
- Preserve one legacy email-keyed delivery record for one recipient position; do not resend legacy Sent or Unknown records. Create independent records for additional signer positions sharing an email.
- Retry known transient/pre-submit SMTP failures and explicit temporary SMTP rate-limit responses up to three attempts. Do not retry permanent recipient/authentication/mailbox errors or ambiguous SUBMIT outcomes.
- Pass existing SMTP stage callbacks into completion email sending and persist bounded, sanitised per-attempt stage history.
- Create personal My Documents copies for eligible profile UIDs; email-only participants continue to receive email without a profile copy.

## Manual backup preservation

No changes are made to the Signature Platform manual tracking UI, first-send/retry buttons, owner recovery assessment, backup-first recovery/retry design, seven-day undo, or fallback controls. The manual path remains available as a backup if automatic delivery reaches a permanent or ambiguous failure.

## Files

- `drive-gateway/src/signatureDistribution.mjs`
- `drive-gateway/src/index.js`
- `drive-gateway/tests/signature-distribution.test.mjs`
- `docs/signature-recovery/finalisation-recovery-change-record-2026-11-22.md`
- `docs/portal-protection/records/signature-portal.json`
- `docs/portal-protection/windows/signature-portal.json`

## Protected invariants

- `Completed` remains independent of email delivery.
- No existing signature, signer record, signing audit event, token, link, session, field, stamp, source hash or completed PDF is rewritten.
- No PDF construction, hashing, certificate, authoritative archive or cryptographic evidence logic is changed.
- No Firestore rules, SMTP host/port/settings, secrets, Worker bindings, credentials or production records are changed.
- Sent and Unknown delivery outcomes are not automatically resent.

## Verification status

- Source diagnosis: PASS
- Targeted test additions: COMMITTED; CI pending
- Portal-protection validation: PENDING
- PR required checks: PENDING
- Merge: NOT DONE
- Production deployment: NOT AUTHORIZED / NOT DONE
- Live recipient delivery: NOT RUN


## Owner clarification — independent delivery trails

The owner clarified on 2026-11-24 that sending/distributing the completed PDF to participants by email must follow a different trail from placing personal copies in My Documents. These are separate delivery channels with separate records, statuses, retry decisions and failure reporting:

- Email: `signatureDistributions`, keyed by owner or signer position, with SMTP stage history and accepted/failed/unknown outcome.
- My Documents: `signaturePersonalCopies`, keyed by recipient profile UID, with independent storage attempt/status and stored path.

A failure or exception in one channel must not prevent the other channel from running or make the other channel appear failed. The owner-triggered retry now attempts both channels independently and returns separate `distribution` and `personalCopies` results. The completed PDF and its integrity hash remain common immutable source material, not a shared delivery status. The automatic finalisation path already isolates the two channel calls; this change also enforces isolation in the manual retry path.


## Owner directive — completion-first invariant (2026-11-24)

The owner explicitly requires that **no email-link e-signature distribution failure may prevent, delay, reverse, or invalidate document completion**. This is a system invariant, not merely a delivery retry preference.

### Mandatory processing boundary

1. Signing, PDF construction, integrity hashing, required certificate/evidence sealing, and authoritative archive persistence remain the prerequisites for completion.
2. The system commits the authoritative envelope state as `Completed` and preserves its completed PDF, final hash, certificate/evidence references, and signing audit chain.
3. Only after that commit may downstream delivery run: (a) participant email distribution and (b) profile-specific My Documents copies. These channels retain independent records, statuses, retries, and recovery.
4. Once the `Completed` commit succeeds, no later exception—including a distribution failure, storage/index failure, summary write failure, status read failure, logging/diagnostic failure, or retry failure—may enter the pre-completion rollback handler, delete authoritative completion artifacts, or change the envelope to `CompletionFailed`.
5. A downstream failure is reported as a delivery/reconciliation problem while the envelope remains `Completed`. Recovery must reuse the authoritative completed PDF and must not reopen signing or create duplicate signature events.

### Code-level guard and regression test

The finalisation routine now records the successful completion commit as an irreversible boundary for that execution. If an unexpected post-commit exception escapes the isolated email/My Documents handlers, the routine returns a completed result with distribution reconciliation flagged; it does not execute cryptographic rollback, delete archived files, or mark the envelope failed.

Regression test: `C-I04 post-completion distribution/reporting failures never roll back Completed` in `drive-gateway/tests/production-crypto-integration.test.mjs`.

This guard does not relax any prerequisite for completion. Failures before the authoritative `Completed` commit—including source integrity, PDF construction, certificate/evidence sealing, and authoritative archive persistence—remain completion failures and retain the existing fail-closed recovery path.
