# IRPA DBGS — Intranet Job Description and Internal Operations Workflow

## Objective

Operate internal IRPA governance and management processes inside DBGS. The intranet is the authenticated in-system workspace and record of process. Internal decisions must not depend on email delivery, external workflow SaaS, spreadsheets or manual circulation.

## Job-description lifecycle

1. **Catalogue control:** The approved role catalogue is read from `config/org-structure-authority.json`. The Executive Director reviews the complete catalogue and releases a versioned snapshot to the Administrator queue.
2. **Administrator assignment:** The Administrator selects an existing active Member or Employee identity and records the appointment/engagement instrument, written delegation or resolution reference, effective date and review/expiry date. The Administrator cannot edit the approved JD snapshot, appoint a person, create missing evidence, or assign reserved Board/Executive Director/Administrator offices.
3. **Delegate release:** The assigned delegate sees the description in the authenticated Role Descriptions portal. The delegate acknowledges receipt inside DBGS. No email link is required.
4. **Executive Director verification:** The Executive Director reviews the recorded references and delegate acknowledgement, then records the governing evidence reference reviewed.
5. **Runtime authorization:** The workflow stops at `VERIFIED_PENDING_SERVER_AUTHORIZATION`. It does not issue Firebase claims, alter member/employee roles, create administrator profiles, grant portal access, enable signature authority, or change bank mandates. Runtime permissions require a separately implemented and tested server-side authorization release based on the governing appointment/delegation instrument and policy checks.

## Authority and separation of duties

- Board of Directors remains the collective governing authority; Board-reserved appointments and decisions are not assigned by the Administrator.
- Executive Director remains the overall management authority and reports to the Board.
- Executive Director and permanent employee Board Secretary remain distinct capacities held by the same incumbent; the Board Secretary office is not assigned through the Administrator workflow.
- Administrator performs controlled administrative routing only. The Administrator cannot rewrite approved descriptions, create appointments, expand delegations, assign Board-reserved powers or alter bank mandates.
- Volunteers remain volunteers. A volunteer title alone grants no management, finance, procurement, bank, administrator, security, research-clearance or production permission.
- All workflow records are non-deletable through client operations; Firestore server audit triggers capture record changes. The workflow itself records actor UID, capacity, timestamps, evidence references and immutable JD snapshot.
- No permissions are activated at any stage of this workflow.

## Intranet technical design

- User identity: existing Firebase Authentication.
- Internal records and state transitions: existing Firestore database and Firestore Security Rules.
- User interface: dedicated Executive Director/Administrator Job Description Administration portal, plus authenticated delegate acknowledgement in Role Descriptions.
- No Firebase Cloud Functions are added; no new billing dependency, email service, third-party workflow service, or new database is introduced.
- Existing production actual-data access gate remains in force. No Firestore rules or production data are deployed by a code merge alone.
- Internal routing and status are visible in the portal. External email is not a prerequisite for release, assignment or acknowledgement.

## Intranet operations consolidation — target architecture

| Process | In-system operating model | External dependency policy |
|---|---|---|
| Job descriptions and role assignment | Versioned JD queue, assignment, acknowledgement, evidence verification and audit | No external workflow/email dependency |
| Governance and Board decisions | Agenda, meeting, resolution, voting, decision and action registers linked by internal references | External invitations may be optional; official records remain in DBGS |
| Delegations and approvals | Authenticated workflow queues with explicit initiator, reviewer, approver, implementer and audit stages | No approval by email reply or spreadsheet |
| Controlled documents and signatures | Internal document lifecycle, access checks, signer routing, signature events and archive records | Cloudflare/Drive gateway remains an optional controlled file transport; workflow state remains internal |
| HR and personnel | Member/employee identity, appointment evidence, induction, role assignment and review dates | External email may notify but cannot be the record of appointment or authorization |
| Finance and procurement | Internal budgets, requests, approval stages, payment trace, vendor records and separation-of-duties checks | Bank execution remains governed by existing bank mandate; banking rails are not replaced |
| Risk, compliance and audit | Internal risk register, corrective actions, evidence register and audit trail | Independent external audit remains external by nature; evidence is indexed internally |
| Research and field data | Internal study, dataset, instrument, observation, clearance and controlled release records | External hosting/analytics are not required for internal authorization; sharing remains clearance-controlled |
| Grants and fundraising | Internal opportunity register, source provenance, pipeline, proposal and reporting records | Crawling/public source discovery may use external websites; internal decisions and records stay in DBGS |
| Communications and publication | Internal drafting, review, approval and publication queue; publish remains OFF until explicitly approved | Website/social platforms are external publishing endpoints only, never approval authorities |
| IT and service continuity | Internal service register, issue/incident log, release readiness, backup evidence and change approvals | Cloud provider consoles remain infrastructure administration surfaces; operational records remain in DBGS |

## Reliability and dependency mitigation controls

- Every internal workflow must have an in-app queue, persistent state, clear owner, due/review date, retry-safe action and audit evidence.
- Internal work must remain readable and actionable if SMTP, social APIs, Google Drive or another external integration is unavailable.
- External integrations must fail independently: a mail failure must not roll back an internal approval or prevent a delegate from opening their assigned work in DBGS.
- Keep external publication, signature file transport, payment execution and third-party data collection behind explicit integration boundaries. Never mirror their credentials or secrets into browser code.
- Prefer existing Firebase/Cloudflare services already used by DBGS; do not introduce new vendors or Cloud Functions for routine internal workflows without a separate cost/security decision.
- No broad migration of live records or permissions is implied by this design. Each module conversion requires its own data mapping, security-rule tests, offline/dependency-failure tests and owner-approved release.

## Acceptance criteria

- Executive Director can review the catalogue and release an approved JD snapshot.
- Administrator can assign only an existing active Member/Employee identity and must supply appointment/engagement, delegation/resolution and date references.
- Reserved Board/Executive Director/Administrator positions cannot be assigned through the Administrator interface.
- Assigned delegate can view and acknowledge only their own assigned JD.
- Executive Director can record evidence verification after acknowledgement.
- Every transition is rejected when performed by the wrong actor, out of order, with missing required evidence fields, or with permission activation attempted.
- No stage automatically creates or changes application roles, claims, administrator profiles, signature permissions, bank mandates or actual-data access.
- Firestore emulator tests, governance regression tests, application build and production-deployment policy checks pass before review/merge.
- Production deployment and live verification are separate release steps and must be evidenced independently.
