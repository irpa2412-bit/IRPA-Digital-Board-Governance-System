# Signature Email-Link Automatic Distribution Repair

- Change ID: SR-2026-11-24-01
- Baseline: 2d4e39d4394ca84ee2246573a3936711979f53af
- Branch: fix/signature-email-link-auto-distribution-20261124
- Owner authorisation: 2026-11-24T08:11:25Z
- Status: implementation branch; PR/CI/live delivery verification pending

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
