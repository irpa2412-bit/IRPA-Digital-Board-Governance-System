# IRPA-DGBS Authorisation & Approval — Safe Migration Map

## Baseline
- Baseline commit: `90de5338298c2a3f0af8fd478103751d72db16c0`
- Protected backup branch: `backup/authorization-pre-migration-2026-09-24`
- Migration branch: `feature/authorization-central-service`
- No production deployment is performed from this migration branch.

## Step A — Freeze current functionality
The current production implementation is preserved unchanged on the backup branch. The migration branch starts from the same known-good commit.

## Step B — Existing authorization logic

### Roles and actors
Current authorization derives primarily from:
- Firebase Authentication UID/email.
- `adminProfiles/{uid}` with `active == true` for administrator access.
- `members/{uid}` with `status == "Active"` for member role authorization.
- `employees/{uid}` for employee identity/enrollment.
- Current Authorization & Approvals roles:
  - Reviewer: Director Internal Oversight, Internal Oversight Officer, Director Human Resources, HR Manager, Director Finance & Administration, Finance Manager, Programme/Technical Officer, Operations Manager.
  - Approver: Executive Director.
  - Implementer: Executive Director, Director Finance & Administration, Finance Manager, Operations Manager, Programme/Technical Officer, Director Human Resources, HR Manager.

### Existing authorization workflow
`src/firebase/authorizationWorkflow.js` implements:
- requester creates Draft;
- requester submits;
- named reviewer moves Submitted → Under Review;
- named reviewer may Return with a reason;
- named approver moves Under Review → Approved or Rejected;
- requester may resubmit after Return;
- named implementer moves Approved → Completed;
- requester cannot approve their own request.

### Firestore enforcement
`firestore.rules` independently enforces:
- active administrator/member checks;
- Authorization & Approvals record shape;
- named reviewer/approver/implementer role checks;
- requester ≠ approver;
- valid workflow transitions;
- required reason for Return/Rejected;
- workflow identity fields are immutable during transitions;
- terminal workflows cannot be changed;
- audit records cannot be updated/deleted.

### UI checks
`src/pages/AuthorizationWorkflow.jsx` controls visible actions for convenience:
- `canReview`
- `canApprove`
- `canImplement`
- action buttons are stage-specific;
- rejection/return requires a reason.

These UI checks are not the security boundary; Firestore rules and the trusted backend must remain authoritative.

### Backend checks
`functions/index.js` contains trusted callable functions for administrator and other sensitive operations. The current Authorization & Approvals transition service is client-side Firestore transaction logic backed by Firestore rules. It must not be treated as the final central authorization boundary.

### Audit events
Current Authorization & Approvals writes:
- `AUTHORIZATION_CREATED`
- `AUTHORIZATION_SUBMITTED`
- `AUTHORIZATION_UNDER_REVIEW`
- `AUTHORIZATION_RETURNED`
- `AUTHORIZATION_APPROVED`
- `AUTHORIZATION_REJECTED`
- `AUTHORIZATION_COMPLETED`

Audit records are append-only in Firestore.

### Signature/approval relationship
Signature Platform has separate signer identity, signature profile, signing ceremony, document hash, authentication evidence and immutable signature records. Authorization migration must not alter or delete those records. Signature authority will be connected later, after the authorization engine is proven.

## Current architectural weaknesses to preserve as explicit migration targets
1. Authorization policy is distributed between UI code, client services and Firestore rules.
2. Role strings are duplicated in several places.
3. General `workflowActions` records have broader participant update/read semantics than the dedicated Authorization transition rules.
4. The current Authorization UI is a workflow controller, not yet a general-purpose users/roles/permissions policy engine.
5. The current authorization workflow does not itself manage permission grants/revocations.
6. Some modules still use direct module-specific role checks.
7. The final trusted central policy decision service does not yet sit in front of every protected operation.

## Step C — Target central authorization service

Canonical decision shape:

`authorize(actor, organisation, action, resource, context) → { allow, reason, decisionId, policyVersion }`

Required properties:
- deny by default;
- authenticated UID required;
- active institutional identity required;
- exact organisation boundary;
- effective permissions = role permissions + explicit grants − revoked grants;
- explicit separation-of-duties checks;
- resource/context conditions;
- fail closed when policy data cannot be verified;
- append-only audit evidence for sensitive decisions;
- notifications remain downstream of an accepted decision.

The service is introduced without changing the existing portal appearance.

## Step D — First sensitive operation

The first centralised protected operation is:
**Authorisation → Grant/Revoke Permission**

Initial migration policy is intentionally narrow:
- only an active Administrator may grant/revoke permissions;
- self-grant is unnecessary because administrator authority is separately controlled;
- target must be an active institutional user;
- permission must be from the controlled catalog;
- grant/revoke is performed through a trusted callable backend service;
- no direct browser write to permission records;
- every grant/revoke creates an immutable audit event;
- revoke is idempotent and never deletes historical records.

No existing module is switched to depend on the new service until this operation passes testing.

## Step E — Incremental integration order

1. Administrator
2. Members
3. Meetings
4. Documents
5. Approvals / Authorization
6. Voting
7. Signatures
8. Finance
9. Reports

Each module must first receive:
- authorization preflight;
- backend enforcement;
- Firestore rule alignment;
- audit verification;
- negative/denial tests;
- rollback path.

## Step F — Interface redesign

Only after the central engine is proven and the module-by-module migration passes testing should the Authorization Portal UI be redesigned around:

USERS → ROLES → PERMISSIONS → POLICY ENGINE → AUTHORIZATION DECISION → ALLOW/DENY → PROTECTED ACTION → AUDIT + NOTIFY.

Until then, the current Authorization & Approvals appearance remains unchanged.

## Functions integration gate — HOLD before production wiring

The staged Authorization callable gateway is intentionally **not** exported from the production Functions entrypoint yet.

During isolated integration verification, the frozen `functions/index.js` was parsed and found to have a pre-existing incomplete `resetTrialData` callable: the function reaches its audit write and then ends at end-of-file without its closing implementation. This is a Functions-entrypoint integrity issue, not an Authorization policy failure.

Safety decision:
- do not wire the new Authorization callables into `functions/index.js` while this defect exists;
- do not deploy Functions;
- preserve the existing entrypoint unchanged;
- keep the Authorization callable gateway isolated and syntax-tested;
- repair and independently test the frozen Functions entrypoint before the Authorization integration boundary is reopened.

This prevents an Authorization migration from becoming the mechanism that introduces or masks a broader Functions deployment failure.

## Portal boundary / inlet-outlet register

The Authorization & Approvals portal remains the subject of this migration. No other portal is being connected at this stage.

Potential external dependencies identified for later, separately tested integration:
- **Administrator portal:** provides administrator identity/access records used by the policy service. Any repair must be performed and tested in the Administrator pathway first; no connection is made now.
- **Members / Employees registers:** provide institutional identity and role data. Any role-data repair belongs to those registers; this migration only reads their current records in the isolated service.
- **Signature Portal:** provides signature authority evidence. No signature connection is made now.
- **Meetings / Documents / Finance / Voting / Reports:** are future protected-operation consumers. They remain on their existing authorization controls until each is separately mapped, tested and connected.
- **Firebase Functions deployment:** is an infrastructure inlet, not an Authorization Portal repair. It remains disconnected until the existing Functions entrypoint is independently repaired and tested.

Migration rule: an identified dependency is recorded as an inlet/outlet and tested in isolation before any connection is enabled. No cross-portal repair is performed merely to make Authorization appear operational.

## Step D controlled test matrix

Before any portal or external-system connection, the central Authorization operation must pass these isolated cases:

| Test | Expected result |
|---|---|
| Unauthenticated decision | DENY |
| Inactive actor | DENY |
| Wrong organisation | DENY |
| Unknown permission | DENY |
| Missing effective permission | DENY |
| Self approval | DENY |
| Unverified signature authority when required | DENY |
| Owner-only operation by non-owner | DENY |
| Valid controlled permission | ALLOW |
| Verified signature authority | ALLOW |
| Valid owner-only operation by owner | ALLOW |
| Duplicate active grant | No duplicate active grant |
| Revocation without reason | DENY / validation failure |
| Revocation of missing grant | Safe idempotent result |
| Revocation of already revoked grant | Safe idempotent result |

The matrix is policy/service validation only. It does not create or modify production authorization records.

### Connection gate

A connection to another portal may proceed only after:
1. the Authorization-side tests pass;
2. the receiving portal's current controls are mapped;
3. the proposed inlet/outlet data contract is documented;
4. negative consequences are tested without enabling production access;
5. rollback is defined;
6. the connection is explicitly approved for the next migration stage.

No cross-portal connection is implicit.

