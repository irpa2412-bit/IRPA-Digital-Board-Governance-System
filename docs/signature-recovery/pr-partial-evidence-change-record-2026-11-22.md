# Signature Recovery Partial Evidence — Change Record

- **Change:** SR-2026-11-22-01
- **Portal:** Signature Portal
- **Baseline / rollback:** `908b314ab0de566d057b4093f4addb11ca434ff3`
- **Branch:** `fix/signature-recovery-partial-evidence-20261122`
- **Repair authorization:** Existing owner-approved 72-hour Signature Portal window opened 2026-11-22 15:35:28 UTC; expires 2026-11-25 15:35:28 UTC. Its recorded scope includes the recovery panel, recovery Worker module and tests. Approval: [PR #895 approval](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/895#issuecomment-7081418969).

## Defect and source findings

1. After the owner queue loads, the panel issues `GET /api/recovery/envelopes/{envelopeId}/evidence`. If the deployed Worker does not recognise that route, the router fallback returns HTTP 404 `{ error: "Not found." }`; the panel previously surfaced that as a generic failure. The route is present in the source router at the baseline, but deployment of that Worker route for commit `908b314a` is **NOT VERIFIED**.
2. The evidence assessor treated missing source-document data as fatal and expected `documents.sha256`. The upload path persists the source hash as `documents.hash`; a missing `sha256` field therefore produced a false integrity failure even when the source file and stored `hash` matched.
3. The evidence assessor rejected a missing source file/document before returning audit-chain or stamp evidence. This hid valid partial evidence.
4. Preview generation is a separate optional `GET /api/recovery/envelopes/{envelopeId}/preview.pdf`; it must report its own reason when unavailable and must not suppress the assessment.

## Exact request sequence

1. `GET /api/recovery/envelopes?limit=50&offset={offset}` — owner queue; returns the queue page or its own authentication/service error.
2. `GET /api/recovery/envelopes/{envelopeId}/evidence` — audit chain, source hash, stamps and recorded finalisation stage; now designed to return partial evidence when individual evidence is absent.
3. Optional user action: `GET /api/recovery/envelopes/{envelopeId}/preview.pdf` — returns a watermarked non-authoritative PDF only when the audit chain and source hash verify; otherwise returns a specific preview-unavailable reason.

## File effects

| File | Intended effect |
|---|---|
| `drive-gateway/src/signatureRecovery.mjs` | Read audit events, source file/hash and stamp fields independently; accept the actual `documents.hash` property; return per-section status/code and map recorded failure stage; keep preview fail-closed when chain/hash are not verified. |
| `drive-gateway/tests/signature-recovery.test.mjs` | Seeded tests for hash compatibility, missing audit events, missing source bytes, missing stamp value, invalid chain and preview refusal. |
| `src/pages/SignatureRecoveryOwnerPanel.jsx` | Identify missing evidence route distinctly; show partial evidence and stage; show per-stamp page/field/code; copy/download sanitised plain-text report; show preview reason. |
| `tests/signature-recovery-owner-panel-readonly.test.mjs` | Enforce GET-only requests, route/auth error distinctions and report/partial-evidence display. |

## Prohibited changes

- No envelope/document/signature/signer/field/token/session/hash/certificate/archive record mutation.
- No signing rules, token or link format, sessions, signer identity, field assignment, stamping, PDF generation, hash algorithm, certificate logic or archive logic changes.
- No Firestore rules, secrets, environment variables, SMTP settings, deployment credentials or branch-protection changes.
- No production login, production envelope mutation, retry, reassignment, completion or direct status change.

## Validation and deployment evidence

- Source review: **PASS** for the identified hash-field mismatch and all-or-nothing evidence failure in the baseline source.
- Local test execution: **NOT RUN** in this execution environment.
- PR CI: **PENDING**; record run IDs and job outcomes after GitHub reports them.
- Worker deployment / health gate for `908b314a`: **NOT VERIFIED**. Do not claim route live until the no-secret-sync Worker deploy run and its commit health gate are retrieved.
- Firebase Hosting and Cloudflare frontend build stamps: **NOT VERIFIED** for this change.
- Production data changes: **NONE**; the affected envelope was not accessed or modified.

## Rollback

Revert this change through a protected PR to baseline `908b314ab0de566d057b4093f4addb11ca434ff3`. No data rollback is required because this change is read-only and makes no envelope writes.

## Current implementation commit

`0696ca7a9ca10f9e1d5835f4baa7ad52f2c8df0a` — Worker partial evidence and hash-field compatibility.

`67aba914fe0d2c644da982245a1c78b9cdac481a` — owner panel partial report and explicit missing-route message.

`5496b61665aab73972275d33dd2d71f67c43f835` — Worker partial evidence tests.

`348e04e8555b10a9390980567e0aa18f5d5ce17e` — UI read-only and report tests.
## Final source revision for this PR

- PR: [#900](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/900) (draft pending required checks).
- Latest Worker source commit: `87a5129ba1ce06ededa82f205c113f19f50df469`.
- Latest seeded Worker tests commit: `1c58b7ed2ed100846f9e9f482b6039ee28ae8114`.
- Latest owner panel/report commit: `81780a360134b58eb425cabfa53b7f344cd56d3d`.
- Latest read-only UI test commit: `6331fce4eb2607ccb21b726ebf2cc6a1fac94f1f`.
- Required PR checks are running against the final PR head; no check is marked PASS in this record until the job conclusion is retrieved.

The final UI test commit above includes a corrected literal matcher for the explicit route-missing message. This Change Record update is the final documentation-only PR-head commit; any validation conclusions will be reported from the resulting head's check runs, not copied from earlier attempts.
