# PR A — owner assessment for every non-Completed envelope

Status: **INCOMPLETE — implementation and tests not yet committed.**

## Purpose and portal
Generalise the read-only recovery assessment from a single diagnostic envelope to every non-Completed envelope in the owner-facing Signature Portal. Owners may assess only envelopes they created. Administrators may assess any envelope. The Gateway Worker remains the authorization boundary: signed-out requests return 401 and authenticated non-owners receive 403.

## Separate repair window
This PR requires its own 72-hour Signature Portal repair window, opened by an owner approval comment on PR #896. PR #895's window is not reused as authorization for this follow-up.

## Required behaviour
- Add **Check this document** for every non-Completed owner envelope, including CompletionFailed, Sent, Opened, Signing, stalled, and signed-row/not-completed states.
- Keep assessment GET-only and read-only for envelope, signer, field, token, hash, certificate, archive and signing audit evidence.
- Return a sanitised English/Kiswahili report with What happened, What is fine, What needs fixing and What you can do now.
- Include audit-chain and source-hash verification; per-stamp PASS/FAILED/MISSING/UNVERIFIABLE with page and field number; finalisation stage and safe error code.
- Do not return tokens, signing URLs, signature images or full addresses. Provide Copy report.
- Validate responses and contain malformed payloads without crashing the Signature Portal.
- Preserve admin-only authority to assess any envelope; never infer authorization from UI visibility.

## Exact planned implementation files
- `src/pages/SignaturePlatformWithUpload.jsx`: mount owner assessment surface in the owner-only view.
- `src/pages/SignatureRecoveryOwnerPanel.jsx`: render every eligible owner envelope, per-envelope assessment control, bilingual report and Copy report.
- `drive-gateway/src/signatureRecovery.mjs`: owner-scoped all-non-Completed queue and assessment contract; no writes to signing records.
- `drive-gateway/tests/signature-recovery.test.mjs`: 401/403/admin/owner-scope and no-mutation tests.
- `tests/signature-recovery-owner-panel-readonly.test.mjs`: per-envelope control, report sanitisation, bilingual sections and malformed-response boundary.
- The two portal protection JSON files and this Change Record document the scope and evidence.

## Prohibited changes
No signature change/reassignment/deletion/re-creation; no automatic retry; no direct or indirect completion; no writes to envelope, signer, field, token, hash, certificate or archive records; no changes to signing rules, token/link formats, sessions, signer identity, field assignment, stamping, PDF, hash, certificate or archive logic; no Firestore rules, secrets, environment variables, SMTP, production data or branch-protection changes.

`src/pages/SignaturePlatform.jsx` is explicitly excluded because the portal registry maps it as shared by Signature Portal and Meeting Portal. This PR must not weaken that multi-portal guard or edit that shared path without the separately governed multi-portal process.

## Baseline and rollback
- Baseline: `908b314ab0de566d057b4093f4addb11ca434ff3`
- Rollback: `908b314ab0de566d057b4093f4addb11ca434ff3`
- Baseline smoke, Signature Portal smoke and full regression: **NOT RUN** for this follow-up.

## Evidence
Implementation, PR-head checks, owner-scope tests, seven-portal smoke and full regression are **NOT VERIFIED**. Do not mark this Change Record complete or merge/deploy until all required checks pass.
