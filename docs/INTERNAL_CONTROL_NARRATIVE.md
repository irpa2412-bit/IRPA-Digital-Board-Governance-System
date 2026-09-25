# IRPA-DGBS Internal Control Narrative

**Status:** Security-hardening implementation document  
**System:** IRPA Digital Board Governance System (IRPA-DGBS)  
**Purpose:** Concise board/auditor-readable description of controls identified in the forensic review.

## 1. Scope
IRPA-DGBS is an internal governance and operations platform covering governance meetings, resolutions and voting, member and employee records, procurement, finance/accounting workflows, authorization and approvals, document control, signatures, audit records, and related operational evidence.

The forensic review assessed source code and configuration. It expressly did not constitute a live penetration test, load test, dependency/CVE assessment, privacy/legal audit, or production-data audit.

## 2. Access Control
Authentication is provided through Firebase Authentication. Authorization is enforced through Firestore rules and server-side Cloud Functions.

The system now prefers server-controlled Firebase custom claims (irpaRoles and admin) for role authorization, while retaining registered member/employee profile data as a migration fallback where required.

Administrator access is separately controlled. The designated primary administrator remains the recovery root, while authorized additional administrators can be granted or revoked through the server-controlled administrator-access workflow. Administrator access changes require an explicit reason and are recorded in the audit collection.

## 3. Invitation and Onboarding Control
Member and employee invitations use a dedicated server-issued invitation token rather than a Firebase password-reset link.

The token contains an invitation identifier and a high-entropy secret. Only the SHA-256 hash of the secret is stored with the invitation record. Invitations expire after a defined period and redemption is bound to the Firebase account associated with the invitation email.

The redemption path is now strictly one-time: an invitation with a recorded redemption timestamp cannot be redeemed again. A fresh invitation must be issued when reactivation is required.

## 4. Document and Storage Control
Firebase Storage is deny-by-default. The current application uses the controlled document gateway for its document-storage workflow; no broad authenticated-user Storage access is permitted by the Firebase Storage rules.

Controlled documents in Firestore retain explicit authorization metadata, including uploader and authorized-user information, and the Firestore rules restrict access according to the governance authorization model.

## 5. Financial Reference Control
Financial reference numbers are issued server-side after defined approval states are reached. The allocation uses a Firestore transaction and a yearly counter, with a collision check against the financial reference registry.

Reference fields are protected from ordinary client modification by Firestore rules. This control is retained as a core financial-integrity mechanism.

## 6. Signature and Audit Trail
Signature identities and authority records are protected by Firestore rules. Signer authority fields are constrained against unauthorized changes, and signature creation requires a current authority record and participation in the relevant signature envelope.

Audit records are append-oriented: authenticated users may create audit entries, while updates and deletes are restricted.

## 7. Procurement and Authorization
Procurement records enforce department/unit structures, workflow states, quotation requirements, vendor controls, and approval transitions through Firestore rules.

Authorization workflows maintain designated requester, reviewer, approver and implementer roles. The rules restrict transitions and preserve immutable workflow identity fields.

## 8. Security Verification
A repository security baseline gate checks critical security invariants, validates Cloud Functions syntax, and builds the web application. Firebase Functions entrypoint integrity checks are also run in CI.

The next assurance layer should be Firebase Emulator-based rules tests covering, at minimum, finance collections, signatureEnvelopes, adminProfiles, documents, invitations, authorization workflows, procurement, and audit records.

## 9. Fundraising Readiness
The existing Donor & Audit Control Cockpit should be represented accurately as an internal management and audit-readiness dashboard, not as a donor CRM.

A later fundraising phase should add a separate donor/funder registry, grant reporting deadlines, donor-ready reporting exports, and external-facing fundraising workflows. These features should remain separated from the tightly controlled governance and finance core.

## 10. Evidence and Independent Assurance
This narrative is an internal control description, not a certification.

Before IRPA relies on the system for sensitive production records at institutional scale, the recommended assurance sequence is:

1. Complete automated Firestore Emulator tests.
2. Verify the production deployment and Firebase rules after the tests pass.
3. Conduct an independent security review/penetration test.
4. Review privacy, data-retention, backup/recovery, and incident-response arrangements.
5. Package the resulting evidence for donor/institutional due diligence.

## 11. Control Philosophy
IRPA-DGBS should evolve by preserving the existing finance and governance control model while adding functionality around it. Fundraising features must not weaken authorization boundaries merely to make external communication easier.