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
