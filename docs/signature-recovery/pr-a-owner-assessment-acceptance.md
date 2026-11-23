# PR A — all-owner non-completed envelope assessment

Status: implementation not yet complete. This document is the PR acceptance boundary, not proof of runtime behaviour.

## Purpose and repair scope

Extend the existing read-only recovery assessment from one failed-completion document to every non-Completed envelope visible to its owner. Owners may assess only envelopes they created; administrators may assess any envelope. The Gateway Worker remains the authorization boundary: signed-out requests return 401 and authenticated non-owners receive 403. The screen must not be treated as an authorization mechanism.

## Required behaviour

- Add a per-envelope “Check this document” action in the owner's Envelopes view for every non-Completed envelope, including Sent, Opened, Signing, CompletionFailed and stalled states, including when signer rows show Signed.
- Assess only the selected envelope, using authenticated GET requests and no state-changing recovery actions.
- Return a sanitised bilingual English/Kiswahili report with “What happened”, “What is fine”, “What needs fixing” and “What you can do now”.
- Report audit-chain and source-hash verification; every stamp as PASS, FAILED, MISSING or UNVERIFIABLE with page and field number; finalisation stage and safe error code.
- Never expose tokens, signing links, signature images, or full addresses. Include Copy report.
- Validate the full Worker response and contain malformed responses without crashing the host application.

## Non-change boundary

No signature, signer, signer identity, field assignment, token, hash, certificate, archive, envelope status, or signing audit record may be changed, reassigned, deleted, overwritten, or recreated. No automatic retry, reassignment, repair, send, finalisation, or completion. No writes to envelope, signer, field, token, hash, certificate or archive records. Do not change signing rules, link formats, sessions, stamping, PDF/hash/certificate/archive logic, Firestore rules, secrets, environment variables, SMTP, or branch protection. Do not mutate the affected production envelope.

## Required tests

- Owner A versus Owner B: 403 for cross-owner assessment; admin may assess any; signed-out 401.
- GET-only assessment; assert complete envelope and signing-evidence snapshots unchanged.
- All non-Completed statuses are discoverable; Completed is excluded.
- Signed signer rows do not imply envelope completion.
- Bilingual report contains all four sections and sanitises forbidden fields.
- Every stamp state includes page and field identifiers; failing finalisation stage and safe code are represented.
- Copy report uses only sanitised content.
- Malformed Worker responses are contained by an error boundary.
- Signature Portal lock tests, seven-portal smoke and full regression pass.

## Evidence and merge gates

This PR requires its own owner-approved 72-hour Signature Portal repair window and a completed portal Change Record with exact file effects, immutable production baseline/rollback commit, baseline smoke, Signature Portal smoke and full-regression job evidence. Until those controls and all required checks pass, this PR remains draft/unmerged and must not be deployed.
