# Signature finalisation recovery — Change Record

- **Change ID:** SR-2026-11-22-03
- **Owner approval:** Explicit owner instruction in the ChatGPT conversation on 2026-11-22.
- **Affected portal:** Signature Portal only.
- **Target:** `IRPA-ENV-2026-11501354` — “Muhtasari wa Kikao cha Familia”.
- **Assessment supplied by owner:** CompletionFailed; finalisation stage NOT_RECORDED; audit chain VERIFIED; source hash VERIFIED; all 12 stamps PASS (page 1: 10 fields; page 3: 2 fields). Signatures intact.
- **Repair window:** 2026-11-22 18:06:00Z through 2026-11-25 18:06:00Z (72 hours).
- **Baseline source/test commit:** `25ddcc6d8f89b6a4103c37a254fbd2af0c26febe` (the previously recorded baseline-evidence commit; baseline smoke, full regression and Signature Portal smoke were recorded PASS in run `45039296254`).
- **Worker rollback reference:** `eb04405e4ec2d64e45d016b6ed3adbc2e8136fbd` (previously verified production Worker deployment, run `44690520757`).
- **Frontend rollback reference:** `eb68a06fdd04454b0e73d2dc9c010eae5519f458` (previously owner-identified deployed frontend build).

## Scope and delivery sequence

### PR 1 — stage recording and dry run
- `drive-gateway/src/signing.mjs`: stage-recording wrappers only around existing finalisation calls. Record stage code, outcome and sanitised error code/message in the finalisation record. Do not change the implementation of any finalisation step.
- `drive-gateway/src/signatureRecovery.mjs`: authenticated owner/admin dry-run orchestration using isolated sandbox dependencies.
- `src/pages/SignatureRecoveryOwnerPanel.jsx`: “Diagnose finalisation” and “Copy report”.
- Focused tests for seeded 12-stamp evidence, each stage failing in turn, page/field diagnostics, EAT timestamps, malformed responses and strict zero-write assertions.

Stages: `PDF_BUILD`, `HASH`, `ARCHIVE`, `CERTIFICATE`, `DISTRIBUTION`.

The dry run must exercise the normal step implementations against sandbox-only metadata/storage/email adapters. It must prove zero writes to the production envelope, signing audit chain, cryptographic evidence, archive or Google Drive. It must report the first failed stage plainly. If source review or dry-run evidence locates the defect inside PDF building, hashing, certificate generation, archive logic or distribution logic, STOP: do not edit that logic; report the exact file/line and proposed change for separate owner approval.

### PR 2 — retry control
- Add owner/admin-only retry after an all-PASS dry run or explicit owner confirmation.
- Back up the envelope record before execution; exclude signature images, tokens and links from the backup.
- Execute the existing normal finalisation once; record a separate audit event with actor, time, action and result.
- Enforce three retries per hour and seven-day undo.
- On failure, restore the pre-retry envelope record and preserve every pre-existing signature and audit event. Do not set `Completed` directly; only normal finalisation may do so after all required stages pass.

## Required tests

- Seed a CompletionFailed envelope with 12 verified stamps across pages 1 and 3, including rotations 0 and 90.
- Each finalisation stage failure records the correct stage code and sanitised error.
- Dry run asserts zero writes to envelope, signing audit, cryptographic evidence, archive and Drive.
- Retry creates a signature-free/token-free backup and a new action audit event; verifies no prior signature or audit event changes; verifies safe rollback on failure.
- Non-owner receives 403; malformed responses never crash the recovery screen.
- Seven-portal smoke, email-signing-contract suite and full regression pass.

## Immutable boundaries

No existing signature, signer identity, signature stamp, signing audit event or source hash may be changed, recreated, reassigned or deleted. No changes to signing rules, tokens, link format, sessions, field assignment, stamping, PDF-building logic, hash logic, certificate logic, archive logic, distribution logic, Firestore rules, secrets, environment variables, SMTP settings, Worker bindings or branch protection. No production envelope mutation during diagnosis.

## Deployment gates

Merge each PR only after normal required branch-protection checks pass. Deploy the Worker only with the existing no-secret-sync workflow; deploy Firebase and Cloudflare frontend through their existing approved workflows. Verify the exact Worker health version and frontend build stamp. No production deployment is included in this opening Change Record commit.

## Current evidence status

- Owner approval: RECORDED.
- 72-hour Signature Portal repair window: OPEN.
- Stage-recording implementation: NOT STARTED.
- Dry-run implementation and zero-write proof: NOT STARTED.
- Retry implementation: DEFERRED TO PR 2.
- Required PR checks, merge and deployment: PENDING.


## Owner decision amendment — 2026-11-22 18:13Z (approved scope)

The owner accepts the source finding at `drive-gateway/src/signing.mjs:440` (the envelope is persisted as `Completed` before the distribution call) and `drive-gateway/src/signatureDistribution.mjs:67–131` (individual recipient delivery failures are caught and represented only in the distribution subsystem). The owner explicitly rejects moving the `Completed` transition after distribution. No change to existing finalisation code is authorised by this finding alone.

### Authoritative meaning of Completed

`Completed` means that signatures are verified, the completed PDF is built, its byte length and hash are recorded, the certificate is built, and the archive write succeeds. Email delivery is independent and must never block or revert `Completed`.

### Newly approved distribution-status change (separate PR)

- Add an envelope-level distribution status: `NotStarted`, `Sent`, `PartiallyFailed`, or `Failed`.
- Record each recipient outcome with a masked address, whether the mail server accepted the message, and a sanitised failure stage code and reply category.
- Propagate individual delivery failures into the envelope distribution status. Do not swallow them without recording their recipient outcome.
- The owner UI must show “Completed, but N emails failed” and offer “Resend completion emails” for failed recipients only, using existing resend rules and signed copies; no new tokens.
- This change must not alter the `Completed` status semantics or the existing signing rules, token/link/session model, signer identity, field assignment, SMTP settings or secrets.

### Revised implementation order

1. **PR 1 (recovery PR #911 remains the repair-window/Change Record PR):** stage recorder and zero-write Diagnose finalisation dry run first. No retry implementation in this PR. The dry run must exercise sandbox adapters and prove zero writes to envelope, audit chain, archive and Drive. Stop and report exact source line plus proposed change if a defect is found inside existing PDF build, hashing, certificate or archive logic; distribution delivery failures are reported without changing delivery implementation in PR 1.
2. **PR 2:** independent distribution status and failed-recipient resend UI, as approved above. Do not move completion after distribution.
3. **PR 3:** owner/admin retry control, backup-first and once-only normal finalisation, audit event, safe failure, seven-day undo and 3/hour rate limit. Never set `Completed` directly.

### Dry-run and retry requirements reaffirmed

The dry run reports each of `PDF_BUILD`, `HASH`, `ARCHIVE`, `CERTIFICATE`, and `DISTRIBUTION` as PASS/FAILED with sanitised stage/error code and page/field diagnostics. It explicitly checks pages 1 and 3, rotations, EAT date/time, placed positions, PDF byte length/hash, certificate build, archive write permission and distribution. “Copy report” is required. It must make no writes to the envelope, signing audit chain, archive or Google Drive.

Retry is owner/admin only and enabled after an all-PASS dry run or explicit owner confirmation. It creates a signature-image/token-free envelope backup first, runs the existing normal finalisation exactly once, records actor/time/action/result in a new audit event, and on failure changes no existing envelope/signature/audit evidence. Undo is available for seven days; rate limit is three attempts per hour. `Completed` is never assigned by the recovery UI or retry wrapper.

### Immutable boundaries

No envelope is to be modified during this work or its diagnosis. Do not touch, redo, reassign or delete any existing signature, audit event or stored hash. Do not modify PDF building, hashing, certificate or archive logic. Do not change signing rules, tokens, link format, sessions, signer identity, field assignment, secrets, environment variables, SMTP settings, Firestore rules or branch protection.


## Owner decision amendment — 2026-11-24 08:11:25Z (automatic distribution repair)

The owner explicitly authorises repair of the automatic email-link completion distribution system and requires the existing manual backup/recovery designs to remain available and unchanged.

### Verified source defects

- `drive-gateway/src/signatureDistribution.mjs` selects recipients through a map keyed by normalized email. Distinct signer positions sharing an address are collapsed into one distribution record and one email.
- The recipient selector includes only signers with `status === "Signed"`, excluding invited signer positions not in that state.
- Automatic completion distribution makes one send attempt per recipient. The existing owner-triggered retry endpoint is separate; it does not provide the required bounded automatic transient retry.
- The completion email adapter in `drive-gateway/src/index.js` does not pass through the existing SMTP `onStage` callback, preventing persisted stage-level delivery diagnostics.
- Personal-copy generation also filters to signed signers, rather than all eligible profile holders associated with the completed envelope.

### Approved implementation boundary

1. Key distribution records by stable recipient position: one document-owner identity and one identity per envelope signer ID. Do not deduplicate by email.
2. Include the document owner and every invited signer/email-link assignment in the envelope. A forwarded-link holder is not a new authorised recipient.
3. Automatically retry only known transient/pre-submit SMTP failures and explicit temporary SMTP rate-limit responses, for no more than three attempts. Do not retry authentication failures, invalid recipients, mailbox-full/permanent failures, or ambiguous SUBMIT outcomes.
4. Pass the existing SMTP stage callback into completion email sending and persist bounded, sanitised per-attempt stage evidence.
5. Create My Documents copies for eligible profile UIDs among the owner and signer positions. Email-only recipients continue to receive email and do not require a profile.
6. Preserve one legacy email-keyed delivery record for one matching recipient position, so previously accepted or ambiguous outcomes are not blindly resent. Additional signer positions sharing that address receive independent records.
7. Preserve the existing manual tracking, first-send/retry controls, recovery assessment, backup-first retry, seven-day undo and fallback designs. No manual control is removed, redesigned or made unavailable.

### Immutable boundaries

`Completed` continues to mean that signing evidence, the completed PDF, its hash, certificate and authoritative archive write succeeded. Email delivery remains independent and cannot block or reverse completion. No existing signatures, signer records, tokens, links, sessions, fields, stamps, audit evidence, source hashes, PDF construction, hashing, certificate or authoritative archive logic may be changed. No Firestore rules, SMTP settings, secrets, Worker bindings, credentials or production envelope records may be changed.

### Validation and release gates

Test independent duplicate-email signer positions, invited signer inclusion, automatic transient retry capped at three, no retry for ambiguous SMTP outcomes, stage-history persistence, personal-copy independence, legacy delivery compatibility, and preservation of manual backup/recovery controls. Merge only after required checks and portal-protection checks pass. Production deployment and live delivery claims require their own release approval and verification.
