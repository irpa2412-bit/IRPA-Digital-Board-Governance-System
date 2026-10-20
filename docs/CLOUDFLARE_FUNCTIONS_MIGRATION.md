# Firebase Cloud Functions → Cloudflare Workers Migration

## Objective

Remove the application's dependency on deploying Firebase Cloud Functions because the current Google Cloud billing state prevents Artifact Registry activation. Migrate every deployed Firebase callable, HTTP function, scheduled function, and Firestore trigger to a secured Cloudflare Worker or Cloudflare scheduled Worker, then remove Firebase Functions deployment steps only after parity and production verification.

This does **not** claim that Firebase Authentication or Firestore are removed. Those services remain dependencies until a separately planned data/authentication migration is completed.

## Non-negotiable safety constraints

- Preserve the existing Cloudflare gateway, OAuth configuration, SMTP invitation delivery, and e-signature platform.
- Preserve Firebase ID-token verification while Firebase Authentication remains the identity authority.
- Use least-privilege service credentials stored only as Cloudflare secrets; never commit credentials.
- Keep administrator authorization server-side. Do not replace privileged functions with client-side writes.
- Preserve atomicity, idempotency, audit events, authorization checks, and existing business rules.
- Keep old Firebase functions available during staged cutover; do not delete or disable them before Worker parity is verified.
- Do not silently skip failing deployment jobs or report migration success based on a successful frontend deployment alone.

## Migration inventory

The repository contains or references these Firebase Functions categories. Each item needs a route/job mapping, compatibility tests, and a verified cutover before its Firebase deployment dependency can be retired.

| Category | Examples identified in repository | Migration requirements |
|---|---|---|
| Invitation and identity | `removeInvitationRecord`, invitation redemption/password setup, identity UID synchronization, login-context resolution, password-reset phone preparation | Secure admin authorization, invitation expiry/token rules, identity linking, activation email workflow, audit trail |
| Authorization and system control | `authorizeAction`, grant/revoke permissions, data-reset request/cancel/execute/status, administrator bootstrap | Server-only privilege checks, approval controls, immutable audit evidence, explicit destructive-action safeguards |
| Meeting governance | meeting entry requests, attendance register, meeting records/transcripts, live meeting token and recording operations | Meeting/category authorization, participant identity checks, signature and evidence preservation, secrets kept server-side |
| Finance and procurement | financial approval/reference triggers, payment trace and finance callable operations | Atomic counters/transactions, no duplicate references, complete ledger/audit integrity, reconciliation |
| Security and audit | password-attempt controls, MFA security audits, global Firestore audit trigger | Rate limiting, scheduled execution, idempotency, complete audit coverage |
| Induction and communications | induction routing/queueing, notification functions, invitation mail queue | Reliable delivery, retry/idempotency, recipient privacy |
| Grant intelligence | scheduled grant crawler and administrator-triggered crawler | Cloudflare Cron + authenticated manual route; verify existing migration and production scheduling |
| Other callable/trigger exports | All remaining exports from `functions/` and all Firebase deployment workflow targets | Inventory each export and every frontend caller; no untracked Firebase Functions deployment target may remain |

## Required execution sequence

1. **Inventory and dependency map:** enumerate every function export, trigger, schedule, secret, frontend caller, deployment workflow, and test. Mark existing Cloudflare equivalents.
2. **Migrate and test by domain:** start with the billing-blocked invitation removal deployment, then invitation/identity, security/authorization, governance/meetings, finance/procurement, scheduled jobs, and remaining exports. Use small reviewable changes.
3. **Compatibility and security tests:** validate unauthenticated, non-admin, expired token, duplicate request, missing record, linked/activated identity, and successful admin cases. Verify audit records and data integrity.
4. **Staging verification:** deploy Workers to staging and run end-to-end tests using staging identity/data only.
5. **Production cutover:** route each caller to its Worker endpoint, verify live behavior and logs, and preserve a rollback path.
6. **Remove Firebase Functions deployment dependency:** only after the complete export-to-Worker matrix is verified, remove Functions deployment steps from CI. Keep Firebase Auth/Firestore rules and data intact unless a separate migration explicitly replaces them.
7. **Closure gate:** prove no active frontend call or scheduled job still requires a Firebase Function; run build, unit/policy, security, browser, invitation, governance, finance, and production smoke tests. Report passed, failed, pending, skipped, and untested checks separately.

## Status

**Partially implemented; not production-verified.** The invitation-register removal callable has a Cloudflare implementation at `POST /api/invitations/remove`, the frontend caller now uses that endpoint, and the dedicated Firebase Functions deployment step for this callable has been removed. Gateway behavior tests cover administrator authorization, protected invitation records, atomic delete-plus-audit writes, and failed commits.

All other Firebase callable functions, schedules, and Firestore triggers remain in scope. Firebase Authentication and Firestore remain dependencies. The new endpoint has not been deployed or verified in production, and no Firebase Function should be disabled solely to make the billing-blocked workflow appear green.
