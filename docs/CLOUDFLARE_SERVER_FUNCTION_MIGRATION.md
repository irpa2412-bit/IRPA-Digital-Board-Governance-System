# Cloudflare Server-Side Function Migration

Target: existing `drive-gateway` Cloudflare Worker. This migration is mandatory and is being executed as a staged, parity-preserving cutover.

## Cutover rules
- Keep Firebase callable functions, scheduled jobs, and Firestore triggers active until their Cloudflare replacements are implemented, tested, and the production callers have been switched.
- Do not weaken Firebase authentication, institutional-role checks, administrator authorization, invitation token validation, signature authorization, financial approval controls, audit records, or transaction atomicity.
- Use the existing Worker authentication, Firestore REST/service-account, Durable Object, mail-delivery, and audit helpers where appropriate; do not add a second gateway or bypass Firestore security rules.
- Every migrated endpoint must have tests for authorization, validation, expected success, failure behavior, and relevant concurrency/idempotency.
- Remove the Firebase deployment dependency only after a function-by-function parity matrix is fully green and production smoke tests confirm the replacement.

## Existing Cloudflare coverage confirmed in source
- Document reference issuance: `POST /api/documents/next-reference` (client caller already uses this route).
- Password-attempt state/failure/clear: `/api/auth/password-attempt-state`, `/api/auth/password-failure`, `/api/auth/password-attempt-clear`.
- Invitation token redemption/session/password setup and invitation email delivery have existing Worker routes.
- Meeting portal/services, communications, document lifecycle, and e-signature routes already run through the Worker.

## Remaining Firebase exports requiring explicit disposition
### Scheduled jobs
- `runGrantCrawlerScheduled`, `runGrantCrawlerNow`
- `runMfaSecurityAuditScheduled`, `runMfaSecurityAuditNow`

### Firestore event triggers
- `captureServerAuditEvent`
- `assignStaffPaymentFinancialReference`
- `assignFinanceTransactionFinancialReference`
- `assignFinanceApprovalFinancialReference`
- `assignFinanceBudgetFinancialReference`
- `assignFinanceReportFinancialReference`

### Authentication, identity, administration, and password recovery
- `checkPasswordAttemptState`, `recordPasswordFailure`, `clearPasswordAttemptState`, `preparePasswordResetPhone`
- `setAdministratorAccess`, `resolveAuthenticatedLoginContext`, `synchronizeRegisteredIdentityUids`, `bootstrapPrimaryAdministrator`
- `updateSignerAuthority`, `createAdministrator`, `listAdministrators`, `removeAdministrator`, `reconcileRegisteredIdentityUids`
- `getActualDataAccessStatus`, `setActualDataAccess`, `resetTrialData`

### Induction, invitations, and directory workflows
- `fetchInductionMatchingRecords`, `sendMemberInvitation`, `redeemInvitationToken`
- `submitInductionApplication`, `routeInductionApplication`, `getInductionApplicationReception`
- `processInductionApplicationAdmin`, `approveInductionApplication`, `rejectInductionApplication`
- `submitCredentialInterview`, `getCredentialInterviewRequests`, `approveCredentialInterview`
- `listMeetingInviteeDirectory`, `removeInvitationRecord`

### Document and meeting workflows
- `nextDocumentReference` (Cloudflare route exists; verify parity and caller coverage)
- `registerMeetingWorkingDocument`, `listMeetingWorkingDocuments`, `submitMeetingDocumentReview`

## Release gates
1. Port an explicitly scoped function group and update all callers in the same change set.
2. Run Worker unit/integration tests, frontend build, relevant security/policy tests, and regression checks.
3. Verify staging against real authentication and authorization boundaries without touching production data.
4. Merge to `main) only after required checks pass.
5. Deploy the existing Cloudflare Worker and verify live endpoints and key governance workflows.
6. Retire the corresponding Firebase exports only after successful production parity verification; retain Firebase deployment for any unmigrated functions.
7. Report passed, failed, pending, skipped, and untested checks explicitly.
