# IRPA-DGBS API Parity Matrix

Status: Gate 2 source evidence consolidated; Gate 2 remains NO-GO until Cloudflare-side prerequisites and email-service decision are verified.

Source repository: irpa2412-bit/IRPA-Digital-Board-Governance-System
Source ref inspected: main
Repository source is available to this implementation environment.

## Backend composition

The Firebase Functions bootstrap is:
- functions/index.js
- functions/authorizationFunctions.js
- functions/liveMeeting.js
- functions/systemControl.js

functions/bootstrap.js exports all four modules through one Functions entrypoint.

### Callable inventory

**functions/index.js — 22 callables**
- nextDocumentReference
- setAdministratorAccess
- synchronizeRegisteredIdentityUids
- bootstrapPrimaryAdministrator
- updateSignerAuthority
- createAdministrator
- listAdministrators
- removeAdministrator
- fetchInductionMatchingRecords
- sendMemberInvitation
- redeemInvitationToken
- submitInductionApplication
- routeInductionApplication
- getInductionApplicationReception
- processInductionApplicationAdmin
- approveInductionApplication
- rejectInductionApplication
- submitCredentialInterview
- getCredentialInterviewRequests
- approveCredentialInterview
- reconcileRegisteredIdentityUids
- resetTrialData

**functions/authorizationFunctions.js — 4 callables**
- authorizeAction
- grantAuthorizationPermission
- revokeAuthorizationPermission
- getEffectiveAuthorizationPermissions

**functions/financeAccountingFunctions.js — 15 callables**
- initializeFinanceStructure
- submitFinanceJournalForApproval
- postFinanceJournal
- reverseFinanceJournal
- closeFinancePeriod
- reconcileFinanceBank
- calculateFinanceBudgetVariance
- getFinanceTrialBalance
- getFinanceStatements
- createFinanceThreeWayMatch
- validateFinanceDonorRestriction
- registerFinanceAsset
- calculateFinancePayroll
- exportFinanceCsv
- importFinanceCsvRows

**functions/liveMeeting.js**
- issueLiveMeetingToken

**functions/systemControl.js**
- requestDataReset
- cancelDataReset
- executeDataReset
- getDataResetStatus

Total callable operations identified from the inspected source: 46. In addition, index.js contains a Firestore onDocumentWritten audit trigger and five financial-reference Firestore triggers.

## Frontend Firebase service evidence

Inspected frontend Firebase service modules include:
- src/firebase/auth.js
- src/firebase/functions.js
- src/firebase/data.js
- src/firebase/invitationWorkflow.js
- src/firebase/procurement.js
- src/firebase/signaturePlatform.js
- src/firebase/signatureStorage.js
- src/firebase/signerIdentity.js
- src/firebase/authorizationWorkflow.js
- src/firebase/systemControl.js
- src/firebase/messaging.js
- src/firebase/notifications.js
- src/firebase/meetingPolicy.js
- src/firebase/workflowLinks.js

Confirmed direct callable invocations include:
- bootstrapPrimaryAdministrator
- sendMemberInvitation
- redeemInvitationToken
- submitCredentialInterview
- getCredentialInterviewRequests
- approveCredentialInterview
- reconcileRegisteredIdentityUids
- nextDocumentReference
- fetchInductionMatchingRecords
- submitInductionApplication
- getInductionApplicationReception
- processInductionApplicationAdmin
- rejectInductionApplication
- approveInductionApplication
- synchronizeRegisteredIdentityUids
- requestDataReset
- cancelDataReset
- executeDataReset
- getDataResetStatus

The frontend also contains dynamic callable invocation wrappers and direct Firestore operations in the Firebase data/service modules. Therefore the Cloudflare parity implementation must not rely only on a static list of literal httpsCallable strings.

Authentication evidence:
- Firebase Auth is used for email/password, Google popup/redirect, email-link sign-in, auth-state observation, account creation and sign-out.
- Administrator Google OAuth is isolated through a dedicated Auth instance in auth.js.

## Firestore security model

firestore.rules was inspected at main, blob SHA:
d1e58781bb8d2e1f1decd040cebf4d3f7c75cb53

Collections represented by explicit rules include:
adminProfiles, adminInvitations, registrationRequests, members, employees, employeeCounters, memberCounters, procurementVendors, procurementVendorScores, procurementVendorBlacklist, procurementQuotationHashes, procurementRequests, invitations, donorFunders, grantReportingObligations, mail, staffPaymentRequests, documents, signerIdentities, signatureProfiles, signatureEnvelopes, signatureEvents, signatures, votingIssues, votes, voteCorrections, voteLocks, auditorProfiles, audit, systemResetPlans, participants, meetings, meetingSubscriptions, meetingRoomEvents, transcriptions, resolutions, actions, decisions, risks, reports, financeChartOfAccounts, financeJournalBatches, financePeriods, financeLedgerJournals, financeLedgerEntries, financePaymentMatches, financeBudgets, financeTransactions, financePaymentTrace, financeReferenceRegistry, financeFunding, financeApprovals, financeCommitments, financeGrants, financeBankAccounts, financeReconciliations, financeAssets, financeRisks, financeReports, authorizationRequests, workflowActions, systemSettings, inductionRecords.

Security helpers include:
signedIn, self, primaryAdmin, adminProfileExists, admin, memberProfileExists, activeMember, activeEmployee, signatureProfileOwner, signatureProfileUser, meetingUser, role, anyMemberRole, auditor, governanceUser, authorityRoleRegistered, signerIdentityAuthorityUnchanged, signerAuthorityUpdateAllowed, authorityRegisterMatch, financeDepartmentMember, procurementDepartmentMember, financePersonnel, financeOversight, financeApprovalOfficer, financePortfolioViewer, financialReferenceFieldsImmutable, financialReferenceFieldsNotSupplied, procurementTeam, procurementApprover, validProcurementDepartment, validProcurementUnit, procurementLocationImmutable, management, hrManagement, authorizationUser, authorizationParticipant, workflowParticipant, validWorkflowStatus, validWorkflowRecord, workflowUpdateAllowed, workflowTerminal, signatureDocumentWorkflowUpdate, signatureEnvelopeAdminUpdate, signatureEnvelopeSignerUpdate, authorizationReviewerRole, authorizationApproverRole, authorizationImplementerRole, validAuthorizationCreate, authorizationImmutable, authorizationTransitionAllowed, registrationReviewer, registrationRoutedToViewer, controlledDocumentCreateAllowed, controlledDocumentReadAllowed.

The final catch-all rule denies unmatched reads/writes.

## Functional parity map

| Functional area | Primary Firebase surface | Security/audit dependencies | Cloudflare migration status |
|---|---|---|---|
| Administrator Management | index.js administrator callables; adminProfiles/adminInvitations | admin/primary-admin checks; audit | Source mapped; route design pending |
| Members & Personnel | data.js, index.js; members/employees/invitations | activeMember/employee, role checks, invitation controls, audit | Source mapped; route design pending |
| Meetings | data.js/meetingPolicy.js/liveMeeting.js; meetings/subscriptions/room/transcriptions | meetingUser/governanceUser; live token; audit | Source mapped; existing Worker must be extended without duplication |
| Participants | participants collection and meeting services | governanceUser/admin | Source mapped |
| Resolutions | resolutions/actions/decisions | governanceUser/admin | Source mapped |
| Voting | votingIssues, participants subcollection, votes, corrections/locks | anonymous vote constraints, activeMember, immutable votes | Source mapped; parity must preserve secrecy |
| Documents | controlled documents; nextDocumentReference | authorizationUser, document workflow, Drive integration, immutable reference control | Source mapped; Drive gateway integration required |
| Signatures | signer identities, profiles, envelopes, events, signatures | signer authority, participant/current-signer checks, immutable signature records | Source mapped; hashes/identity records must be preserved |
| Authorization & Approval | authorizationFunctions.js, authorizationWorkflow.js, workflowActions/authorizationRequests | central policy, named reviewer/approver/implementer, separation of duties, immutable workflow rules | Source mapped; remains security boundary |
| Finance | financeAccountingFunctions.js and finance collections | finance roles, approval roles, immutable references, audit | Source mapped |
| Procurement | procurement.js/procurementRequests/vendors/quotations | procurementTeam/approver, location/method/quotation controls | Source mapped |
| Reports | reports collection and finance reporting functions | governance/management/finance controls | Source mapped |
| Risk Register | risks collection | governanceUser/admin | Source mapped |
| Employee Payments | staffPaymentRequests | HR/finance/Executive Director separation and financial reference trigger | Source mapped |
| Notifications | notifications collection; messaging/notification services | recipient-scoped reads; server-generated writes | Source mapped |
| Audit Trail | audit collection plus server Firestore trigger | immutable audit create/update/delete controls | Source mapped |
| System Reset | systemControl.js/systemResetPlans | admin-only reads; server-controlled reset operations | Source mapped; Cloudflare equivalent must retain multi-step gate |

## Existing Google Drive gateway

The migration must evolve the existing Worker:
irpa-google-drive-gateway

Do not create a second Drive gateway. File IDs, hashes, versions, permissions and signature-related evidence must remain attributable to their existing records.

## Gate 2 blockers

1. Cloudflare zone is still reported Pending.
2. Cloudflare API connection requires re-authentication.
3. R2, Email Routing and Secrets Store remain unverified.
4. Outbound email provider decision remains unresolved. Option A (mail.irpa.or.tz:465) must not be treated as verified until the SMTP endpoint is confirmed reachable/usable; no SMTP credential is to be committed.
5. Full frontend-to-function caller mapping still requires continued source tracing beyond literal callable strings because the application contains dynamic wrappers and direct Firestore service operations.

## Gate 2 safety decision

NO-GO.

This is not a failure of repository access: the actual Firebase source and Firestore rules have now been inspected. NO-GO remains because the Cloudflare-side prerequisites and email dependency are not yet evidenced.

No production route, Firebase authentication, Firestore data, DNS application record, or Cloudflare Worker deployment was changed by this evidence exercise.
