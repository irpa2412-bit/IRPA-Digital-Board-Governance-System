# Firebase Functions Migration — Execution Inventory

Baseline: `main` at `863af99307696a1ae954a679ce6232ca8c2eadd5` (8 November 2026).

This inventory is the control record for the staged migration to the existing Cloudflare Gateway and already-established Cloudflare services. It is a source-code inventory, not proof that every exported function is currently deployed in Firebase. The live Firebase Functions deployment list and live trigger configuration have not yet been independently retrieved.

## Safety and cutover rules

- Keep Firebase Authentication and Firestore as retained services for now. This work removes the dependency on deploying Firebase Cloud Functions; it does not migrate Firebase Authentication or Firestore.
- Do not remove, disable, or stop deploying an existing callable, scheduled job, or Firestore trigger until its callers have been switched and staging plus production parity has passed.
- Preserve Firebase ID-token verification, active-register checks, administrator checks, institutional role/authority checks, invitation expiry and token rules, financial approval rules, transaction atomicity, idempotency, and audit writes.
- Keep actual-data access fail-closed. A missing Worker route, missing setting, failed authorization check, or failed read must resolve to CLOSED/denied, never OPEN/allowed.
- Do not alter Firestore rules, production secrets, billing, or production services as part of inventory or staging work.
- Firebase Admin operations embedded in GitHub Actions are separate from Cloud Functions. They must not be removed when Functions deployment steps are retired.

## 1. Actual Functions entrypoint and export registration

Firebase configuration points to `functions/` (`firebase.json`). The package entrypoint is **`functions/bootstrap.js`**, not `functions/index.js` (`functions/package.json` sets `main: bootstrap.js`). The bootstrap spreads these modules:

1. `functions/index.js`
2. `functions/authorizationFunctions.js`
3. `functions/liveMeeting.js`
4. `functions/meetingGateway.js`
5. `functions/meetingRecords.js`
6. `functions/meetingAttendanceRegister.js`
7. `functions/systemControl.js`

The index itself imports and exports `passwordSecurity.js`, `grantCrawler.js`, and `mfaSecurityAudit.js`. It also defines the global audit trigger and five financial-reference triggers.

### Callable exports registered through the configured entrypoint

**Core identity, administrator, induction, invitation and system callables from `functions/index.js`:**

- `nextDocumentReference`
- `setAdministratorAccess`
- `resolveAuthenticatedLoginContext`
- `synchronizeRegisteredIdentityUids`
- `bootstrapPrimaryAdministrator`
- `updateSignerAuthority`
- `createAdministrator`
- `listAdministrators`
- `removeAdministrator`
- `fetchInductionMatchingRecords`
- `sendMemberInvitation`
- `redeemInvitationToken`
- `submitInductionApplication`
- `routeInductionApplication`
- `getInductionApplicationReception`
- `processInductionApplicationAdmin`
- `approveInductionApplication`
- `rejectInductionApplication`
- `submitCredentialInterview`
- `getCredentialInterviewRequests`
- `approveCredentialInterview`
- `reconcileRegisteredIdentityUids`
- `resetTrialData`
- `getActualDataAccessStatus`
- `setActualDataAccess`
- `removeInvitationRecord`

**Password security (`functions/passwordSecurity.js`):**

- `checkPasswordAttemptState`
- `recordPasswordFailure`
- `clearPasswordAttemptState`
- `preparePasswordResetPhone`

**Authorization (`functions/authorizationFunctions.js`):**

- `authorizeAction`
- `grantAuthorizationPermission`
- `revokeAuthorizationPermission`
- `getEffectiveAuthorizationPermissions`

**Live meeting (`functions/liveMeeting.js`):**

- `issueLiveMeetingToken`
- `startMeetingRecording`
- `stopMeetingRecording`
- `getMeetingRecordingStatus`

**Meeting access (`functions/meetingGateway.js`):**

- `createMeetingAccessInvitation`
- `revokeMeetingAccessInvitation`
- `authorizeMeetingEntry`
- `listMeetingEntryRequests`
- `listMeetingInviteCandidates`
- `resolveMeetingEntryRequest`
- `listMeetingInviteeDirectory`

**Meeting records and working documents (`functions/meetingRecords.js`):**

- `captureMeetingRecord`
- `translateMeetingTranscript`
- `saveLiveMeetingProceedings`
- `saveMeetingAssistantDraft`
- `listMeetingRecords`
- `retrieveMeetingRecord`
- `updateMeetingRecordProtection`
- `disposeMeetingRecord`
- `compileAndEmailMeetingReport`
- `registerMeetingWorkingDocument`
- `listMeetingWorkingDocuments`
- `submitMeetingDocumentReview`

**Attendance (`functions/meetingAttendanceRegister.js`):**

- `signMeetingAttendance`
- `getMeetingAttendanceRegister`

**System reset (`functions/systemControl.js`):**

- `requestDataReset`
- `cancelDataReset`
- `executeDataReset`
- `getDataResetStatus`

The index also re-exports three meeting-working-document callables and the meeting invitee directory callable from the modules above. These are duplicate export paths to the same handlers, not additional distinct functions.

### Scheduled jobs and Firestore triggers

**Scheduled jobs:**

- `runGrantCrawlerScheduled`: Firebase schedule configured as every six hours in `Africa/Dar_es_Salaam`.
- `runMfaSecurityAuditScheduled`: scheduled Firebase job; exact schedule and timezone must be captured from its source and compared with any live deployed schedule before cutover.
- Manual callable companions: `runGrantCrawlerNow` and `runMfaSecurityAuditNow`.

**Firestore event triggers:**

- `captureServerAuditEvent`: `onDocumentWritten` wildcard trigger over all documents; excludes `audit` and `systemResetPlans` to prevent recursive/system-reset audit loops.
- `assignStaffPaymentFinancialReference`: `onDocumentUpdated` for `staffPaymentRequests/{docId}`.
- `assignFinanceTransactionFinancialReference`: `onDocumentUpdated` for `financeTransactions/{docId}`.
- `assignFinanceApprovalFinancialReference`: `onDocumentUpdated` for `financeApprovals/{docId}`.
- `assignFinanceBudgetFinancialReference`: `onDocumentUpdated` for `financeBudgets/{docId}`.
- `assignFinanceReportFinancialReference`: `onDocumentUpdated` for `financeReports/{docId}`.

The financial-reference triggers issue references only after their collection-specific approval state is reached. The current implementation uses a Firestore transaction and a yearly counter/registry to prevent duplicate references. Any replacement must preserve those concurrency and uniqueness guarantees.

## 2. Frontend and workflow caller map

| Caller / workflow | Firebase Functions dependency identified | Existing Cloudflare path or disposition |
|---|---|---|
| `src/firebase/auth.js` | `bootstrapPrimaryAdministrator`, `preparePasswordResetPhone` | Password-attempt state/failure/clear already call the Gateway. Invitation redemption/session/password setup use Gateway endpoints. Both primary-admin bootstrap and phone-recovery preparation now call Cloudflare routes on this branch; the Firebase callable exports remain registered for rollback. |
| `src/firebase/data.js`, `src/App.jsx` | `resolveAuthenticatedLoginContext` | App calls the resolver during login/authority selection. The existing `/api/session/profile` route is not yet proven to have full response/authorization parity. |
| Members and Employees pages via `src/firebase/data.js` | `synchronizeRegisteredIdentityUids` | A Cloudflare reconciliation route/helper exists; frontend wrapper is already Gateway-oriented. Verify the live route, role enforcement and exact-email/no-overwrite behavior. |
| `src/firebase/functions.js`, Credential Interview page | `submitCredentialInterview`, `getCredentialInterviewRequests`, `approveCredentialInterview` | No complete Worker parity established yet. |
| `src/firebase/functions.js`, Administrator portal | Administrator create/list/remove are currently implemented with direct Firestore writes/reads in the frontend wrapper, not these callable names. Verify rules and audit behavior; do not assume a callable replacement is required for these three UI actions. |
| `src/firebase/systemControl.js`, System Reset Control | `requestDataReset`, `cancelDataReset`, `executeDataReset`, `getDataResetStatus` | No Worker parity established. These are privileged destructive operations and currently require `IRPA_RESET_DEVELOPER_SECRET`; migration requires an explicitly designed server-side authorization/approval contract. |

The reset executor deletes across many collections in Firebase batches of up to 400 and has a 540-second callable timeout. It must not be copied as one long Cloudflare HTTP request: Workers Free allows 10 ms CPU per HTTP invocation and 50 external subrequests. Its replacement must be resumable/checkpointed in small batches, preserve the grace period and same-requester execution rule, and safely resume after interruption. The existing `IRPA_RESET_DEVELOPER_SECRET` must be available as a server-only Worker secret before staging acceptance; do not expose or log its value.
| `src/firebase/systemControl.js`, actual-data control | `getActualDataAccessStatus`, `setActualDataAccess` | Frontend uses `/api/system/actual-data-access`. Existing Worker policy requires an active administrator and exact final-test attestation to open. Verify failure defaults and audit parity before retiring callables. |
| `src/firebase/meetingRecords.js`, Meeting Room | `registerMeetingWorkingDocument`, `listMeetingWorkingDocuments`, `submitMeetingDocumentReview`, `signMeetingAttendance`, `getMeetingAttendanceRegister` | Meeting record/media operations already use Worker routes; working-document and attendance callables remain direct callable dependencies. |
| `src/components/MeetingAccessControl.jsx` | `listMeetingEntryRequests`, `resolveMeetingEntryRequest` | Issue/revoke/authorize meeting access and related meeting routes use Worker APIs. Pending-request listing and decision still use Firebase callables. |
| `src/components/IRPADGBSMeetingRoomMedia.jsx` | `issueLiveMeetingToken` fallback | Worker token route exists and is the preferred path; Firebase callable fallback remains a production code dependency until removed after Worker acceptance. |
| `src/firebase/data.js`, Finance Technology Operations | Dynamic finance callable dispatch is referenced by `src/components/FinanceTechnologyOperations.jsx`. | Exact callable names and export registration require separate reconciliation. `functions/financeAccountingFunctions.js` defines 15 callables but is **not spread by the configured `functions/bootstrap.js` entrypoint**. Do not count these source definitions as registered production exports without independent deployment evidence. |
| `src/firebase/meetingGatewayApi.js`, meeting pages | Meeting invitation, revoke, entry authorization, live token, activity, subscription and meeting-register APIs | These wrappers use Worker endpoints. Audit conditional fallbacks and all call sites before declaring Firebase-independent. |
| `src/firebase/data.js`, induction workflow | Induction submission and administrator reception callables; matching lookup uses Gateway | `submitInductionApplication`, `getInductionApplicationReception`, and admin processing/approval/rejection still require route-by-route parity. |
| `.github/workflows/firebase-deploy.yml` | Selective deploy attempts for login resolver, password-reset phone preparation, actual-data access and attendance callables | Steps currently use `continue-on-error: true`; this masks the billing blocker rather than providing a safe migration. Retain until callers are cut over and tested. |
| `.github/workflows/deploy-livekit-staging.yml` | Staging-only `issueLiveMeetingToken` deploy and LiveKit secret setup | Explicitly guarded against the production Firebase project. Keep isolated until the Cloudflare LiveKit route and private recording storage pass acceptance. |

## 3. Secrets, security and infrastructure dependencies

| Dependency | Current use | Migration requirement |
|---|---|---|
| Firebase Authentication ID tokens | Browser identity; Gateway verifies Firebase token signature, issuer, audience and expiry | Retain token verification while Firebase Auth remains the identity provider. Never trust client-supplied UID/email/role as authentication. |
| Firestore | Member/employee/admin registers, invitations, governance records, financial counters, meeting records and audit | Existing Worker uses Firestore REST/service-account access for privileged operations and Firebase-token access for user-scoped reads. Preserve Firestore rules unchanged. |
| `INVITE_SERVICE_KEY` | Secret binding in invitation/meeting record callable paths and induction email queue | Replace only with an approved Cloudflare secret binding and tested delivery/rotation behavior; never expose the value. |
| `IRPA_RESET_DEVELOPER_SECRET` | Additional authorization for data-reset planning/execution | Do not move destructive reset endpoints until the equivalent server-only secret/approval and audit contract is explicitly verified. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Firebase callable LiveKit token and recording operations | Existing Worker/LiveKit migration docs describe separate staging/R2 prerequisites. Do not copy values or enable production fallback changes as part of this inventory. |
| Google service-account credential used by Gateway | Privileged Firestore REST access and server-side metadata operations | Use existing least-privilege Worker identity only where permissions are verified. Do not add broad project-owner credentials. |
| Cloudflare Durable Object/KV | Existing Gateway auth state and e-signature persistence helpers | Reuse existing bindings; do not introduce a second Gateway or change production bindings without separate approval. |
| Actual-data gate | Firestore setting and Worker policy route | Fail closed on missing/invalid data, auth failure, policy failure or storage failure. No migration step may automatically open the gate. |

## 4. Existing Cloudflare equivalents — not yet all parity-certified

- Password attempt state, failure recording and clear: `/api/auth/password-attempt-state`, `/api/auth/password-failure`, `/api/auth/password-attempt-clear` in `drive-gateway/src/cloudflareAuth.mjs`; frontend already uses these paths.
- Login-context resolution: `POST /api/auth/login-context` added in this migration branch. `src/firebase/data.js` now calls the Worker using the signed-in Firebase ID token. The resolver uses the existing server-side Firestore service identity to reproduce the callable's UID-first, email-fallback, administrator-linked Employee, active-record and authority-building behavior. The Firebase callable remains registered for rollback; unit/CI parity tests are pending.
- Primary-administrator bootstrap: `POST /api/auth/bootstrap-primary-administrator` added in this migration branch. The frontend now calls the Worker; the Worker requires the signed-in token to identify the designated primary email, preserves existing custom claims, updates the `admin` claim through the existing Identity Toolkit service identity, and atomically commits the admin profile plus audit event. If the Firestore commit fails, the Worker attempts to roll back the custom-claims change. The Firebase callable remains registered for rollback.
- Password-recovery phone preparation: `POST /api/auth/password-reset/prepare` and `POST /api/auth/password-reset/clear` added in this migration branch. The Worker uses the existing Identity Toolkit and Firestore service identities to resolve the Auth account and the exact registered Member/Employee mobile number, refuses ambiguous or mismatched phone records, and updates Firebase Auth only when its phone is absent. Recovery preparation is rate-limited by email (3 per 15 minutes) and source IP (10 per 15 minutes) using the existing Durable Object; the email limit is cleared only after a Firebase phone-auth ID token proves the registered phone number. The frontend no longer imports or calls Firebase Functions for this recovery path. The original callable remains registered for rollback.
- Document reference issuance: `/api/documents/next-reference`; client wrapper already calls Gateway.
- Actual-data gate: `/api/system/actual-data-access`; frontend wrapper already calls Gateway and the Worker policy has an explicit attestation constant.
- Registered identity UID reconciliation: `/api/members/reconcile-registered-identity-uids`; Worker route and exact-match policy helper exist.
- Signer authority update: `/api/signature/authority`; Worker route exists.
- Invitation redemption/session/password setup/send/removal: Gateway routes exist; confirm each caller and authorization parity.
- Meeting portal and meeting services: Worker routers exist for access, records/media and meeting services. Attendance signing/register and meeting working-document review are not yet proven fully replaced.
- Induction matching: Worker router exists; application submission and administrator review/reception remain callable dependencies until parity is tested.
- Grant crawler: dedicated Cloudflare crawler Worker(s) and deployment documentation exist in the repository. Verify which Worker is the authoritative production scheduler and whether the Firebase schedule is still live before changing either schedule.
- Free-plan scheduling: Workers Free allows at most five Cron Triggers per account. Reuse/consolidate existing crawler and MFA schedules; do not create one Cron Trigger per migrated Firebase scheduled function.
- MFA security audit and financial-reference triggers: no complete replacement and parity evidence established in this inventory.

## 5. Source-only functions not registered by the current package entrypoint

- `functions/financeAccountingFunctions.js` defines 15 finance callables (initialization, journal approval/posting/reversal, period close, bank reconciliation, budget variance, trial balance/statements, three-way match, donor restrictions, asset registration, payroll, CSV export/import). The configured `functions/bootstrap.js` does not currently require this module. The UI contains a generic finance callable-dispatch caller, so this is a caller/export mismatch that must be resolved before finance migration. Do not assume these handlers are deployed or silently add them to the entrypoint.
- Other helper modules under `functions/` are not themselves deployable exports unless imported by `bootstrap.js` or one of its required modules.

## 6. Deployment and verification status at inventory time

- **Source export registration:** established from `functions/package.json`, `functions/bootstrap.js`, `functions/index.js` and the required module files.
- **Frontend caller mapping:** principal direct callable call sites and Worker-oriented wrappers identified above; dynamic call dispatch and less common fallback paths remain subject to targeted call-site searches and tests.
- **Live Firebase deployment inventory:** NOT RETRIEVED. Source exports do not prove a function is deployed or active.
- **Live Firebase trigger/schedule inventory:** NOT RETRIEVED. Source declarations do not prove deployed trigger configuration.
- **Login-context migration slice:** IMPLEMENTED on the migration branch; Firebase callable retained for rollback; no production caller cutover.
- **Login-context, primary-admin bootstrap and password-recovery unit/CI tests:** QUEUED / IN PROGRESS at the time of this update; no PASS claim yet.
- **Cloudflare staging parity:** NOT RUN.
- **Production acceptance:** NOT RUN in this inventory change.
- **Production code/config/secrets/rules:** UNCHANGED.
- **Remaining authentication/identity disposition:** the active frontend callers for login context, primary-admin bootstrap, password-recovery phone preparation, password-attempt state, signer-authority update and registered-identity reconciliation now use Cloudflare routes in source. `setAdministratorAccess` has no frontend caller found in the repository search and remains registered until live Firebase inventory confirms whether it is deployed or externally invoked. Other dormant/legacy exports also remain pending live inventory.

## 7. Ordered implementation gates

1. Complete this inventory against live Firebase function/trigger listings and all dynamic caller names. Resolve the finance callable/export mismatch and exact MFA schedule before any cutover.
2. Migrate authentication and identity functions in small groups. Begin with the login-context and password-recovery callers; retain Firebase Auth as identity provider and test unauthenticated, expired-token, inactive-register, dual-role and administrator cases.
3. Migrate governance/system controls. Prove actual-data gate remains CLOSED by default and cannot be opened without an authenticated active administrator and the exact attestation.
4. Migrate meeting, induction and invitation operations, including pending meeting-entry decisions, attendance, working-document reviews, credential interviews and induction admin review.
5. Migrate financial-reference allocation, global audit coverage and scheduled crawler/MFA jobs. Prove duplicate/retry/concurrency behavior and audit completeness.
6. Run staging parity and production acceptance per function group, with production caller cutover only after staging PASS.
7. Remove Firebase Functions deployment steps and exports only when the caller/trigger matrix is fully green and no production caller or trigger depends on Firebase Functions. Retain GitHub Actions Firebase Admin bootstrap/backfill tasks unless separately replaced and verified.

A function-group status must use PASS / FAIL / PENDING / NOT RETRIEVED / NOT APPLICABLE. A successful frontend build or Worker health check is not proof of callable, trigger, financial, attendance or security parity.
