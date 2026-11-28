# IRPA PCU — Supervisor, Responsibility and Reporting Workflow

**Status:** Domain model and workflow specification for controlled implementation. This document does not appoint supervisors, activate delegations, grant portal permissions or certify production deployment.

## Operating relationship

1. **Executive Director:** accountable for management-wide implementation and approves management delegations within Board-approved authority.
2. **Directorate / Department Head:** receives a current appointment and written delegation; allocates approved work within that scope; reviews subordinate reports and escalates exceptions.
3. **Unit Head / Supervisor:** may allocate and review work only where an approved reporting relationship and written sub-delegation expressly permit it.
4. **Officer / Specialist / Field or Support Staff:** acknowledges assigned responsibilities, performs the work and submits attributable reports with supporting evidence.
5. **Internal Oversight:** receives independent assurance access under its approved functional mandate; must not review or audit its own work.
6. **Executive Director → Board:** management consolidates operational results and escalates reserved matters to the Board. The Board retains collective constitutional authority.

## Relationship record

A reporting relationship binds a supervisor identity and organisational node to a subordinate identity and node. Required evidence: approved appointment/acting appointment, approved job description, written delegation or Board resolution where applicable, effective date, optional end date, and verification actor. New relationships begin as `PENDING_VERIFICATION`; titles, node membership or seniority alone do not establish authority. Conflicting or expired relationships are denied. Every relationship is tenant-scoped and auditable.

## Responsibility lifecycle

`DRAFT → ASSIGNED → ACKNOWLEDGED → IN_PROGRESS → SUBMITTED → UNDER_REVIEW → ACCEPTED`

Alternative transitions: `UNDER_REVIEW → RETURNED → RESUBMITTED`; `UNDER_REVIEW → REJECTED`; authorised supervisor may `REVOKE` or supersede an assignment with a reason and a new version. The original assignment and all report versions remain in the audit history.

Each assignment records: duty ID/version, responsible identity, supervisor identity, organisational node, objective, deliverables, due date, reporting cadence, service standard, performance indicators, evidence requirements, effective dates, status and audit metadata.

## Report contents and review

Reports record the reporting period, concise narrative, outputs/results, blockers/risks, next steps and evidence references. Submission is attributable to the assigned person. The named supervisor may accept, return with reasons or reject with reasons. The author cannot review their own report. A supervisor sees only reports within verified reporting scope; management receives aggregated cross-department views according to approved authority. Internal Oversight access is read-only and independent.

## Notifications and escalation

Assignment, acknowledgement, due-date reminders, report submission, review decisions and overdue escalation create audit events and notifications. Escalation follows an approved, versioned policy and verified reporting chain; it never silently reassigns authority. All timestamps are stored consistently and displayed in East Africa Time.

## Security and separation

- Assignment, acknowledgement and reporting are operational records, **not** Firebase custom claims or portal permissions.
- No role or delegation is inferred from a title, email address, department label or reporting node.
- A supervisor may act only with verified identity, active engagement, current appointment, approved job description and written delegation.
- Initiator, approver, implementer and independent auditor duties remain separated where applicable.
- No self-approval; no deletion of responsibility, report or audit history; corrections use versioned amendments.
- Default deny for inactive, ambiguous, expired, suspended or revoked identities/relationships.
- Finance, procurement, banking, signature, Board voting and other reserved authorities remain governed by their separate policies and controls.

## Release gates

1. Verify the PCU installation and current main-branch code.
2. Complete read-only identity restoration and resolve conflicts before linking staff UIDs.
3. Confirm actual supervisor/subordinate relationships from approved records; do not seed assumed incumbents.
4. Implement server-side authorization and Firestore rules for scoped assignment, submission, review and read access.
5. Add emulator tests for cross-tenant access, inactive identities, expired delegations, supervisor scope, report privacy, self-review, audit immutability and separation of duties.
6. Pass CI, independent verification and staging regression tests before any production promotion.
