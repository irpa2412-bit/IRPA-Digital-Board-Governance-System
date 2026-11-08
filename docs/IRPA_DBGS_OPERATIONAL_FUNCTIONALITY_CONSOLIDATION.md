# IRPA-DBGS operational functionality consolidation

**Baseline:** `main` at `53dab49f636f2c5b3440a83e2346466538dc2bb2` (8 November 2026).
**Purpose:** consolidate regression protection and release evidence for the most operationally important portal functions without replaying stale pull-request branches or duplicating code already present in `main`.

This is an integration and regression-gate change. It does not claim that CI proves live business acceptance, and it does not replace the separate release approvals for staging or production.

## 1. Consolidation decision

The reviewed backlog contains several PRs whose proposed functionality is already represented in the current `main` tree. Their branches are not to be merged wholesale. The integration workflow therefore exercises the current implementations and the existing focused tests.

| Operational area | Relevant PR lineage | Current-main evidence and disposition |
|---|---|---|
| Signature and controlled documents | #623, #600, #190, #487, #636 | Server-side signer visibility filtering and signature lifecycle/security tests already exist. #190's older direct-Firestore listing change is not transplanted over the current Gateway-filtered list route. #600 is a historical investigation, not a retrieval repair. #487 must be reconciled against the current Gateway routes, not copied from its old base. #623's additional administrator verifier remains a separate gap: its own description limits acceptance to in-memory metadata/storage and generated keys, not Firebase Emulator or real Drive. It also documents that the current ECDSA evidence is not a PAdES/CMS PDF signature, X.509 chain, or trusted TSA timestamp. Do not describe it as qualified/trusted digital signing. #636's shadow-mode authority bypass is excluded because it permits signing after an authority-policy rejection. |
| Meetings and invitations | #441, #445, #596, #634 | The current participants portal contains individual and bulk failed-invitation resend logic; Meeting Room excludes failed/undelivered invitations from attendance/quorum. The Gateway has meeting access issue/revoke/authorize routes and invitation mail support. The focused resend/quorum test and meeting-isolation guard are included in the regression workflow. The old PR #445 branch is not copied because its patch is based on an older implementation and its proposed resend code used legacy callable paths. |
| Communication and Media | #617, #620, #609, #613, #577, #528 | Website Studio automatically requests connection status when mounted and has read-only diagnostics. The main branch already contains the editorial/publishing policy and global pause controls. #617's small status change is therefore not duplicated. Draft/media and WordPress/cPanel write acceptance still require isolated staging verification; CI cannot prove live credentials or public-site behavior. Social publishing remains subject to its existing default-off and approval controls. |
| Grant Intelligence and funding | #587, #593, #362, #270, #267, #266 | The current crawler already bounds `/opportunities` reads with a default page size of 50 and maximum 100, uses a 60-second in-memory cache, and returns HTTP 503 when D1's daily read limit is reached and no stale cache is available. Pipeline routes also classify D1 quota exhaustion. #587's old branch is not transplanted; #593's authenticated mock tests remain distinct from live integration acceptance. No staging crawl is run by this workflow. |
| Research Statistics and Knowledge | #284, #599 and current portal work | The current Research Statistics and Knowledge Portal includes studies, datasets, observations, analyses, knowledge, outputs and a restricted archive provisioning route. Existing research security tests are included. A successful static/security test does not prove live data quality, ethics approval, access governance, retention, backup or recovery acceptance. |

## 2. Required regression coverage

The consolidated GitHub Actions workflow runs the existing tests rather than replacing them with weaker source-text assertions:

1. Signature and Gateway: the complete `drive-gateway` Node test suite, including signer visibility, signature workflow, document lifecycle, asset authorization, completion persistence and meeting routes.
2. Meeting operations: failed-invitation resend/quorum tests, meeting media governance checks and meeting source-isolation tests.
3. Communications: existing communication/media policy tests.
4. Grant Intelligence: the existing crawler Worker test suite, with no live crawl or D1 writes.
5. Research: existing Research Portal security tests.
6. Application: production Vite build.

The workflow is read-only with respect to production and staging services. It has `contents: read` only; it has no deploy, dispatch, secret, Firestore, Cloudflare or external-service write step.

## 3. Explicit non-goals and protected boundaries

- No Firestore rules changes.
- No production or staging deployment, data writes, WordPress edits, email sends, or grant crawler run.
- No secrets or credential values added, printed, or changed.
- No change to `VITE_IRPA_CRYPTOGRAPHIC_SIGNING_ENABLED`; it remains OFF.
- No weakening of signer, meeting, finance, communications, data-gate or administrator authorization.
- No use of shadow mode to allow a signer whose authority check was rejected.
- No removal of Firebase Functions or their triggers before caller inventory, staging parity and production acceptance.
- No claim that a green CI run establishes real SMTP delivery, live WordPress/cPanel access, completed-PDF archive retrieval, actual-data authorization, or production parity.

## 4. Operational acceptance still required after CI

| Area | Live acceptance evidence still required |
|---|---|
| Signature | A controlled source PDF remains linked to its envelope; signer-specific visibility and authority are correct; signing completes; the final PDF is persisted and retrievable by authorized users only; source/final hashes and audit evidence verify; owner/signer behavior is explicitly tested. |
| Meetings | A real staging invitation is dispatched through the approved gateway; token redemption and separate gate-password validation work; revocation/resend and quorum counts are correct; attendance, records and archives are preserved. |
| Communication and Media | Isolated staging WordPress and cPanel read/write/rollback tests pass; editorial approval is recorded; public rendering and rollback are verified; social channels remain disabled until separately accepted. |
| Grant Intelligence | A controlled, bounded staging read succeeds after D1 quota recovery; source URL and provenance are retained; authenticated analysis and eligibility are correct; no crawl is used as a substitute for official donor verification. |
| Research and Knowledge | Authorized users can register and validate datasets, preserve source/consent/ethics metadata, reproduce analyses, control publication, and demonstrate backup/retention/recovery. |

## 5. Merge gate

A green workflow is necessary but not sufficient. Review the exact PR head SHA, every required status check, changed-file scope, and protected branch requirements. Any failed, skipped, or missing required check blocks merge. Staging and production acceptance remain separate authorized release steps.

**Status at creation:** current-main source review completed for the listed areas; this PR adds the shared regression gate and this source-grounded consolidation record. It does not claim to close the remaining live acceptance gaps above.
