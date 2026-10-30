# IRPA Digital Board Governance System — Software Requirements Specification

**Status:** Reverse-engineered; owner validation required. **Baseline:** main @ f20403e6f26c296f9d3aa3cda87588115a0f694d.

## Scope and evidence

**Detailed acceptance specification:** See [ACCEPTANCE-CRITERIA-ADDENDUM.md](ACCEPTANCE-CRITERIA-ADDENDUM.md) for additional module-, sub-portal-, standalone-portal-, AI-, offline-, mobile- and governance-specific Given/When/Then criteria, proposed test IDs and requirement→page→test→criterion traceability. The addendum extends (does not replace) the baseline inventory and explicitly distinguishes proposed tests from executed tests.
Source-derived navigation, portal components and Worker entrypoint paths are documented here. Source presence is not proof of live production operation. Dataset Registry, Research Data Collection and Release Readiness are normative standalone portal requirements; their separate top-level navigation is a proposed gap. Grant Intelligence is discovery/analysis only; concept-note advice is internal drafting, not donor submission.

## Inventory
- 31 top-level modules; 15 registered sub-portals (6 Meetings, 8 Documents, 1 Induction).
- 41 source page components; 3 standalone portal requirements; 21 component/subsystem screens; 5 shared/workflow screens.
- 72 page-specific wireframes.

### Top-level modules
1. IT Operations — MOD-01
2. Dashboard — MOD-02
3. Induction and Orientation — MOD-03
4. Induction Applications — MOD-04
5. Board Members Registration — MOD-05
6. Members & Personnel — MOD-06
7. Invitations — MOD-07
8. Meetings — MOD-08
9. Resolutions — MOD-09
10. Voting — MOD-10
11. Actions — MOD-11
12. Documents — MOD-12
13. Signature Platform — MOD-13
14. Decisions — MOD-14
15. Risk Register — MOD-15
16. Authorization & Approvals — MOD-16
17. Employee Payments — MOD-17
18. Research, Statistics and Knowledge — MOD-18
19. Finance Portfolio — MOD-19
20. Procurement — MOD-20
21. Reports — MOD-21
22. Audit Trail — MOD-22
23. Grant Intelligence & Funding Opportunities — MOD-23
24. Communication & Media — MOD-24
25. Downloads — MOD-25
26. Settings — MOD-26
27. Add Administrator — MOD-27
28. Department and Archive Registry — MOD-28
29. Department Portal Builder — MOD-29
30. External Auditor Portal — MOD-30
31. Auditors & Special Invitees — MOD-31

### Registered sub-portals
- Meetings → Meeting Room — SUB-01
- Meetings → Participants — SUB-02
- Meetings → Resolutions — SUB-03
- Meetings → Voting — SUB-04
- Meetings → Actions — SUB-05
- Meetings → Decisions — SUB-06
- Documents → My Documents — SUB-07
- Documents → Department Documents — SUB-08
- Documents → Shared With Me — SUB-09
- Documents → Signing Workspace — SUB-10
- Documents → Post-Signature Work — SUB-11
- Documents → Final Archive — SUB-12
- Documents → Upload Document — SUB-13
- Documents → Retrieve Archived Documents — SUB-14
- Induction and Orientation → Induction Applications — SUB-15

### Standalone portals
- Dataset Registry — STD-01; separate top-level navigation is a proposed gap.
- Research Data Collection — STD-02; separate top-level navigation is a proposed gap.
- Release Readiness — STD-03; separate top-level navigation is a proposed gap.

## Roles and authorization
Source indicates administrator, board/member, employee, finance, procurement, HR, IT, auditor, signer and invitation/induction capacities. The role register and per-record permissions are specified in the role matrix below; management owner sign-off remains required. Board governance permissions are limited to governance records and workflows. UI hiding is not authorization; every protected read/write must be enforced server-side. Actual and Trial environments remain distinct; identity/security records remain in Actual Data as the source gate specifies.

## Functional requirements and Given/When/Then criteria
All test IDs are PROPOSED until mapped to executable tests.

### MOD-01 — IT Operations
Priority: MUST. Page: it-operations. Test: TEST-PROPOSED-MOD-01 (PROPOSED).
- MOD-01-AC1: Given the caller has the IT Operations role, when the diagnostics view is requested, then the response lists each configured service name, health state and last-checked timestamp, and omits credentials, tokens and secret configuration values.
- MOD-01-AC2: Given a non-IT user calls an IT operation directly, when the protected request is submitted directly to the server, then server-side authorization denies it and records the denial.

### MOD-02 — Dashboard
Priority: MUST. Page: dashboard. Test: TEST-PROPOSED-MOD-02 (PROPOSED).
- MOD-02-AC1: Given an authorized user loads the dashboard, when the dashboard page is loaded, then cards contain only role- and environment-scoped data.
- MOD-02-AC2: Given one data source fails, when the dashboard requests data from the unavailable source, then its card shows an error/retry without blocking other cards.

### MOD-03 — Induction and Orientation
Priority: MUST. Page: induction-and-orientation. Test: TEST-PROPOSED-MOD-03 (PROPOSED).
- MOD-03-AC1: Given an invited user has an induction record, when the user performs the operation described in this scenario, then required steps and current status appear in sequence.
- MOD-03-AC2: Given all required steps are complete, when the user submits the induction completion request, then server validation is required before status becomes Completed.

### MOD-04 — Induction Applications
Priority: MUST. Page: induction-applications. Test: TEST-PROPOSED-MOD-04 (PROPOSED).
- MOD-04-AC1: Given an authorized reviewer opens an application, when the application detail view is requested, then applicant fields, status and review history appear.
- MOD-04-AC2: Given a reviewer approves/rejects, when the reviewer submits the decision, then decision, reviewer, timestamp and required reason are stored.

### MOD-05 — Board Members Registration
Priority: MUST. Page: board-members-registration. Test: TEST-PROPOSED-MOD-05 (PROPOSED).
- MOD-05-AC1: Given an authorized administrator submits complete identity/appointment fields, when the create or registration request is submitted, then a unique registration is saved.
- MOD-05-AC2: Given required fields are missing or identity is duplicated, when the invalid form is submitted, then save is blocked with field-level errors.

### MOD-06 — Members & Personnel
Priority: MUST. Page: members-and-personnel. Test: TEST-PROPOSED-MOD-06 (PROPOSED).
- MOD-06-AC1: Given HR opens the register, when the user submits the register search, then search returns only personnel records within assigned scope.
- MOD-06-AC2: Given a personnel record changes, when the record update is saved, then actor, timestamp, changed fields and resulting status are audited.

### MOD-07 — Invitations
Priority: MUST. Page: invitations. Test: TEST-PROPOSED-MOD-07 (PROPOSED).
- MOD-07-AC1: Given an authorized issuer creates an invitation, when the create or registration request is submitted, then a unique recipient-bound token and expiry are stored.
- MOD-07-AC2: Given a token is expired, revoked, redeemed or mismatched, when the user attempts to activate or use the invitation, then activation is rejected and no identity is provisioned.

### MOD-08 — Meetings
Priority: MUST. Page: meetings. Test: TEST-PROPOSED-MOD-08 (PROPOSED).
- MOD-08-AC1: Given a user opens Meetings, when the corresponding portal or register is opened, then only in-scope meetings appear with date, status and participation.
- MOD-08-AC2: Given a secretary supplies meeting title, date/time, agenda and participant list, when the meeting save request is submitted, then the server returns the saved meeting ID and stores the creator UID and creation timestamp in the meeting audit history; missing title, date/time or agenda returns field-level validation errors.

### MOD-09 — Resolutions
Priority: MUST. Page: resolutions. Test: TEST-PROPOSED-MOD-09 (PROPOSED).
- MOD-09-AC1: Given a meeting has resolutions, when the user performs the corresponding portal action, then each record shows ID, text, status, owner and source meeting.
- MOD-09-AC2: Given a resolution status changes, when the record update is saved, then previous/new state, actor and timestamp are retained.

### MOD-10 — Voting
Priority: MUST. Page: voting. Test: TEST-PROPOSED-MOD-10 (PROPOSED).
- MOD-10-AC1: Given voting is open and a user is eligible, when the user performs the corresponding portal action, then one valid vote is recorded once for that voter/item.
- MOD-10-AC2: Given voting is closed, voter ineligible or vote already exists, when the user submits the vote, then submission is rejected and tally unchanged.

### MOD-11 — Actions
Priority: MUST. Page: actions. Test: TEST-PROPOSED-MOD-11 (PROPOSED).
- MOD-11-AC1: Given an action list opens, when the corresponding portal or register is opened, then owner, due date, status, source decision and overdue state appear.
- MOD-11-AC2: Given an assignee updates progress, when the record update is saved, then prior/new state, actor and timestamp are retained.

### MOD-12 — Documents
Priority: MUST. Page: documents. Test: TEST-PROPOSED-MOD-12 (PROPOSED).
- MOD-12-AC1: Given a document list is requested, when the user performs the operation described in this scenario, then role, department, ownership and sharing rules filter results server-side.
- MOD-12-AC2: Given an upload passes validation, when the upload is submitted for storage, then metadata, version, uploader and classification are stored.

### MOD-13 — Signature Platform
Priority: MUST. Page: signature-platform. Test: TEST-PROPOSED-MOD-13 (PROPOSED).
- MOD-13-AC1: Given a named signer opens a valid envelope, when the signature action is submitted, then only the assigned document and required fields are accessible.
- MOD-13-AC2: Given signing succeeds, when the signature action is submitted, then signer identity, timestamps, evidence and audit events are stored; failure never marks completion.

### MOD-14 — Decisions
Priority: MUST. Page: decisions. Test: TEST-PROPOSED-MOD-14 (PROPOSED).
- MOD-14-AC1: Given the decisions register opens, when the reviewer submits the decision, then source meeting, text, owner, date and implementation status appear.
- MOD-14-AC2: Given implementation status changes, when the record update is saved, then decision history and linked action state update consistently.

### MOD-15 — Risk Register
Priority: MUST. Page: risk-register. Test: TEST-PROPOSED-MOD-15 (PROPOSED).
- MOD-15-AC1: Given a risk has likelihood, impact, owner and mitigation, when the user performs the operation described in this scenario, then its rating is calculated/displayed by the documented scale.
- MOD-15-AC2: Given a risk is reassessed, when the record update is saved, then previous/current rating, mitigation and reviewer are retained.

### MOD-16 — Authorization & Approvals
Priority: MUST. Page: authorization-and-approvals. Test: TEST-PROPOSED-MOD-16 (PROPOSED).
- MOD-16-AC1: Given a request is submitted, when the corresponding save or submit action is sent, then it routes only to an approver authorized for type and amount/scope.
- MOD-16-AC2: Given an unauthorized user attempts approval directly, when the protected request is submitted directly to the server, then server-side authorization denies and audits it.

### MOD-17 — Employee Payments
Priority: MUST. Page: employee-payments. Test: TEST-PROPOSED-MOD-17 (PROPOSED).
- MOD-17-AC1: Given finance opens a payment batch, when the user performs the operation described in this scenario, then employee, period, amount, approval and payment state appear per line.
- MOD-17-AC2: Given a batch is submitted, when the corresponding save or submit action is sent, then validation/approvals pass before it locks for processing; transitions are audited.

### MOD-18 — Research, Statistics and Knowledge
Priority: MUST. Page: research-statistics-and-knowledge. Test: TEST-PROPOSED-MOD-18 (PROPOSED).
- MOD-18-AC1: Given a research user lists datasets/outputs, when the search filters are submitted, then title, owner, classification, version and access are displayed.
- MOD-18-AC2: Given an output is published, when the user performs the operation described in this scenario, then metadata/approval checks pass and source records retain their classification.

### MOD-19 — Finance Portfolio
Priority: MUST. Page: finance-portfolio. Test: TEST-PROPOSED-MOD-19 (PROPOSED).
- MOD-19-AC1: Given finance requests a summary, when the user performs the operation described in this scenario, then totals reflect selected actual/trial environment, period and currency.
- MOD-19-AC2: Given a non-finance user requests a finance endpoint directly, when the protected request is submitted directly to the server, then the server denies access.

### MOD-20 — Procurement
Priority: MUST. Page: procurement. Test: TEST-PROPOSED-MOD-20 (PROPOSED).
- MOD-20-AC1: Given a request has valid specifications, budget and requester, when the user performs the operation described in this scenario, then it receives a unique reference and workflow state.
- MOD-20-AC2: Given an approver decides, when the user performs the operation described in this scenario, then decision, justification, approver and timestamp are stored; only valid next states are allowed.

### MOD-21 — Reports
Priority: MUST. Page: reports. Test: TEST-PROPOSED-MOD-21 (PROPOSED).
- MOD-21-AC1: Given a user selects report/date filters, when the user performs the operation described in this scenario, then output contains only authorized records matching filters.
- MOD-21-AC2: Given export completes, when the user performs the operation described in this scenario, then report title, generation time, filter scope and classification label are included.

### MOD-22 — Audit Trail
Priority: MUST. Page: audit-trail. Test: TEST-PROPOSED-MOD-22 (PROPOSED).
- MOD-22-AC1: Given an authorized auditor searches a period, when the search filters are submitted, then events show actor, action, target, timestamp and outcome.
- MOD-22-AC2: Given the authenticated user lacks the Audit Trail read permission, when the user requests the audit query endpoint directly, then the server returns HTTP 403, returns no audit-event payload and writes a security-denial event containing actor UID, requested action, target and timestamp.

### MOD-23 — Grant Intelligence & Funding Opportunities
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-MOD-23 (PROPOSED).
- MOD-23-AC1: Given crawler discovery is ingested, when the user performs the operation described in this scenario, then source URL, timestamp, provenance and Pending Verification state are retained.
- MOD-23-AC2: Given an analyst requests eligibility/alignment, when the user performs the operation described in this scenario, then criterion evidence, IRPA fit, confidence and unknowns appear; no donor contact or application submission occurs.

### MOD-24 — Communication & Media
Priority: MUST. Page: communication-and-media. Test: TEST-PROPOSED-MOD-24 (PROPOSED).
- MOD-24-AC1: Given an authorized communications user opens channels/content, when the user performs the operation described in this scenario, then connection status, state and ownership appear without credentials.
- MOD-24-AC2: Given approved content is published, when the user performs the operation described in this scenario, then version, destination, actor, time and provider result are audited; drafts remain unpublished.

### MOD-25 — Downloads
Priority: MUST. Page: downloads. Test: TEST-PROPOSED-MOD-25 (PROPOSED).
- MOD-25-AC1: Given Downloads loads, when the user performs the operation described in this scenario, then each resource shows title, type, version and classification.
- MOD-25-AC2: Given protected download is unauthorized, when the protected request is submitted directly to the server, then no bytes are returned and denial is recorded.

### MOD-26 — Settings
Priority: MUST. Page: settings. Test: TEST-PROPOSED-MOD-26 (PROPOSED).
- MOD-26-AC1: Given an administrator opens settings, when the user performs the operation described in this scenario, then value, scope and role editability are displayed.
- MOD-26-AC2: Given a setting change passes validation/authorization, when the user performs the operation described in this scenario, then it persists with before/after audit; unauthorized changes fail.

### MOD-27 — Add Administrator
Priority: MUST. Page: add-administrator. Test: TEST-PROPOSED-MOD-27 (PROPOSED).
- MOD-27-AC1: Given an authorized administrator provisions an account, when the create or registration request is submitted, then a least-privilege invitation is created after identity/approval checks.
- MOD-27-AC2: Given a non-admin attempts provisioning, when the user performs the operation described in this scenario, then server denies and creates no administrator record.

### MOD-28 — Department and Archive Registry
Priority: MUST. Page: department-and-archive-registry. Test: TEST-PROPOSED-MOD-28 (PROPOSED).
- MOD-28-AC1: Given an authorized registry user creates a valid identifier/owner/classification, when the create or registration request is submitted, then a unique registry entry is saved.
- MOD-28-AC2: Given archive search filters are applied, when the search filters are submitted, then lifecycle, retention class and authorized retrieval route are returned.

### MOD-29 — Department Portal Builder
Priority: MUST. Page: department-portal-builder. Test: TEST-PROPOSED-MOD-29 (PROPOSED).
- MOD-29-AC1: Given a builder submits unique key, parent, label and access policy, when the corresponding save or submit action is sent, then a portal definition is saved.
- MOD-29-AC2: Given a definition is activated, when the user performs the operation described in this scenario, then only matching users see it and previous configuration is recoverable.

### MOD-30 — External Auditor Portal
Priority: MUST. Page: external-auditor-portal. Test: TEST-PROPOSED-MOD-30 (PROPOSED).
- MOD-30-AC1: Given an active auditor invitation is verified, when the user performs the operation described in this scenario, then only assigned audit material and time-bounded access appear.
- MOD-30-AC2: Given access expires/revokes, when the user performs the operation described in this scenario, then every protected request is denied immediately.

### MOD-31 — Auditors & Special Invitees
Priority: MUST. Page: auditors-and-special-invitees. Test: TEST-PROPOSED-MOD-31 (PROPOSED).
- MOD-31-AC1: Given an authorized administrator supplies identity, purpose, scope and expiry, when the user performs the operation described in this scenario, then a time-bounded invite is created.
- MOD-31-AC2: Given invite is invalid, expired or out of scope, when the user attempts to activate or use the invitation, then access is denied and logged.

### SUB-01 — Meeting Room
Priority: MUST. Page: meetings-meeting-room. Test: TEST-PROPOSED-SUB-01 (PROPOSED).
- SUB-01-AC1: Given a user has access to Meetings and the required child permission, when Meeting Room is selected, when the user performs the operation described in this scenario, then only in-scope records are displayed in the child view.
- SUB-01-AC2: Given child permission is absent or the parent portal is unavailable, when Meeting Room is requested directly, when the user performs the operation described in this scenario, then access is denied and protected content is not returned.

### SUB-02 — Participants
Priority: MUST. Page: meetings-participants. Test: TEST-PROPOSED-SUB-02 (PROPOSED).
- SUB-02-AC1: Given a user has access to Meetings and the required child permission, when Participants is selected, when the user performs the operation described in this scenario, then only in-scope records are displayed in the child view.
- SUB-02-AC2: Given child permission is absent or the parent portal is unavailable, when Participants is requested directly, when the user performs the operation described in this scenario, then access is denied and protected content is not returned.

### SUB-03 — Resolutions
Priority: MUST. Page: meetings-resolutions. Test: TEST-PROPOSED-SUB-03 (PROPOSED).
- SUB-03-AC1: Given a user has access to Meetings and the required child permission, when Resolutions is selected, when the user performs the operation described in this scenario, then only in-scope records are displayed in the child view.
- SUB-03-AC2: Given child permission is absent or the parent portal is unavailable, when Resolutions is requested directly, when the user performs the operation described in this scenario, then access is denied and protected content is not returned.

### SUB-04 — Voting
Priority: MUST. Page: meetings-voting. Test: TEST-PROPOSED-SUB-04 (PROPOSED).
- SUB-04-AC1: Given a user has access to Meetings and the required child permission, when Voting is selected, when the user performs the operation described in this scenario, then only in-scope records are displayed in the child view.
- SUB-04-AC2: Given child permission is absent or the parent portal is unavailable, when Voting is requested directly, when the user performs the operation described in this scenario, then access is denied and protected content is not returned.

### SUB-05 — Actions
Priority: MUST. Page: meetings-actions. Test: TEST-PROPOSED-SUB-05 (PROPOSED).
- SUB-05-AC1: Given a user has access to Meetings and the required child permission, when Actions is selected, when the user performs the operation described in this scenario, then only in-scope records are displayed in the child view.
- SUB-05-AC2: Given child permission is absent or the parent portal is unavailable, when Actions is requested directly, when the user performs the operation described in this scenario, then access is denied and protected content is not returned.

### SUB-06 — Decisions
Priority: MUST. Page: meetings-decisions. Test: TEST-PROPOSED-SUB-06 (PROPOSED).
- SUB-06-AC1: Given a user has access to Meetings and the required child permission, when Decisions is selected, when the reviewer submits the decision, then only in-scope records are displayed in the child view.
- SUB-06-AC2: Given child permission is absent or the parent portal is unavailable, when Decisions is requested directly, when the reviewer submits the decision, then access is denied and protected content is not returned.

### SUB-07 — My Documents
Priority: MUST. Page: documents-my-documents. Test: TEST-PROPOSED-SUB-07 (PROPOSED).
- SUB-07-AC1: Given a user has access to Documents and the required child permission, when My Documents is selected, when the user performs the operation described in this scenario, then only in-scope records are displayed in the child view.
- SUB-07-AC2: Given child permission is absent or the parent portal is unavailable, when My Documents is requested directly, when the user performs the operation described in this scenario, then access is denied and protected content is not returned.

### SUB-08 — Department Documents
Priority: MUST. Page: documents-department-documents. Test: TEST-PROPOSED-SUB-08 (PROPOSED).
- SUB-08-AC1: Given a user has access to Documents and the required child permission, when Department Documents is selected, when the user performs the operation described in this scenario, then only in-scope records are displayed in the child view.
- SUB-08-AC2: Given child permission is absent or the parent portal is unavailable, when Department Documents is requested directly, when the user performs the operation described in this scenario, then access is denied and protected content is not returned.

### SUB-09 — Shared With Me
Priority: MUST. Page: documents-shared-with-me. Test: TEST-PROPOSED-SUB-09 (PROPOSED).
- SUB-09-AC1: Given a user has access to Documents and the required child permission, when Shared With Me is selected, when the user performs the operation described in this scenario, then only in-scope records are displayed in the child view.
- SUB-09-AC2: Given child permission is absent or the parent portal is unavailable, when Shared With Me is requested directly, when the user performs the operation described in this scenario, then access is denied and protected content is not returned.

### SUB-10 — Signing Workspace
Priority: MUST. Page: documents-signing-workspace. Test: TEST-PROPOSED-SUB-10 (PROPOSED).
- SUB-10-AC1: Given a user has access to Documents and the required child permission, when Signing Workspace is selected, when the signature action is submitted, then only in-scope records are displayed in the child view.
- SUB-10-AC2: Given child permission is absent or the parent portal is unavailable, when Signing Workspace is requested directly, when the signature action is submitted, then access is denied and protected content is not returned.

### SUB-11 — Post-Signature Work
Priority: MUST. Page: documents-post-signature-work. Test: TEST-PROPOSED-SUB-11 (PROPOSED).
- SUB-11-AC1: Given a user has access to Documents and the required child permission, when Post-Signature Work is selected, when the signature action is submitted, then only in-scope records are displayed in the child view.
- SUB-11-AC2: Given child permission is absent or the parent portal is unavailable, when Post-Signature Work is requested directly, when the signature action is submitted, then access is denied and protected content is not returned.

### SUB-12 — Final Archive
Priority: MUST. Page: documents-final-archive. Test: TEST-PROPOSED-SUB-12 (PROPOSED).
- SUB-12-AC1: Given a user has access to Documents and the required child permission, when Final Archive is selected, when the user performs the operation described in this scenario, then only in-scope records are displayed in the child view.
- SUB-12-AC2: Given child permission is absent or the parent portal is unavailable, when Final Archive is requested directly, when the user performs the operation described in this scenario, then access is denied and protected content is not returned.

### SUB-13 — Upload Document
Priority: MUST. Page: documents-upload-document. Test: TEST-PROPOSED-SUB-13 (PROPOSED).
- SUB-13-AC1: Given a user has access to Documents and the required child permission, when Upload Document is selected, when the upload is submitted for storage, then only in-scope records are displayed in the child view.
- SUB-13-AC2: Given child permission is absent or the parent portal is unavailable, when Upload Document is requested directly, when the upload is submitted for storage, then access is denied and protected content is not returned.

### SUB-14 — Retrieve Archived Documents
Priority: MUST. Page: documents-retrieve-archived-documents. Test: TEST-PROPOSED-SUB-14 (PROPOSED).
- SUB-14-AC1: Given a user has access to Documents and the required child permission, when Retrieve Archived Documents is selected, when the user performs the operation described in this scenario, then only in-scope records are displayed in the child view.
- SUB-14-AC2: Given child permission is absent or the parent portal is unavailable, when Retrieve Archived Documents is requested directly, when the user performs the operation described in this scenario, then access is denied and protected content is not returned.

### SUB-15 — Induction Applications
Priority: MUST. Page: induction-and-orientation-induction-applications. Test: TEST-PROPOSED-SUB-15 (PROPOSED).
- SUB-15-AC1: Given a user has access to Induction and Orientation and the required child permission, when Induction Applications is selected, when the user performs the operation described in this scenario, then only in-scope records are displayed in the child view.
- SUB-15-AC2: Given child permission is absent or the parent portal is unavailable, when Induction Applications is requested directly, when the user performs the operation described in this scenario, then access is denied and protected content is not returned.

### STD-01 — Dataset Registry
Priority: MUST. Page: dataset-registry. Test: TEST-PROPOSED-STD-01 (PROPOSED).
- STD-01-AC1: Given a steward supplies title, owner, source, schema/version, classification, consent/legal basis and access policy, when the user performs the operation described in this scenario, then a versioned metadata record is saved without copying restricted source data.
- STD-01-AC2: Given a user searches datasets, when the search filters are submitted, then only permitted metadata appears with version, steward and lifecycle status.

### STD-02 — Research Data Collection
Priority: MUST. Page: research-data-collection. Test: TEST-PROPOSED-STD-02 (PROPOSED).
- STD-02-AC1: Given a collection form has missing required fields or invalid types/ranges, when the user attempts to activate or use the invitation, then submission is blocked with field-level errors.
- STD-02-AC2: Given valid data synchronizes, when the user performs the operation described in this scenario, then collector, time, location precision policy, consent, instrument version and sync state are stored idempotently.

### STD-03 — Release Readiness
Priority: MUST. Page: release-readiness. Test: TEST-PROPOSED-STD-03 (PROPOSED).
- STD-03-AC1: Given a release is assessed, when the user performs the operation described in this scenario, then build, tests, security, migration, rollback, support and approval gates show PASS/FAIL/NOT RUN with evidence.
- STD-03-AC2: Given any mandatory gate is FAIL or NOT RUN, when the user performs the operation described in this scenario, then release approval is blocked and unresolved gate IDs are shown.

### AI-01 — Crawler isolation
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-AI-01 (PROPOSED).
- AI-01-AC1: Given a crawl runs, when the user performs the operation described in this scenario, then source fetch and writes remain inside the grant-crawler Worker and declared grant datasets, never Drive Gateway or unrelated collections.
- AI-01-AC2: Given a source fails/times out, when the dashboard requests data from the unavailable source, then its failure is recorded, other sources continue within concurrency limits and failed data is not marked verified.

### AI-02 — Eligibility
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-AI-02 (PROPOSED).
- AI-02-AC1: Given an official call is available, when the user performs the operation described in this scenario, then applicant/geography/sector/registration/co-funding criteria show PASS/FAIL/UNKNOWN with evidence and timestamp.
- AI-02-AC2: Given a mandatory criterion is UNKNOWN, when the user performs the operation described in this scenario, then eligibility is UNVERIFIED and is not represented as eligible.

### AI-03 — Donor alignment
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-AI-03 (PROPOSED).
- AI-03-AC1: Given official donor objectives and approved IRPA profile are selected, when the user performs the operation described in this scenario, then objectives map to IRPA objectives with evidence, mismatch and confidence.
- AI-03-AC2: Given authoritative donor evidence is absent, when the user performs the operation described in this scenario, then alignment is UNKNOWN and no donor priority/score is invented.

### AI-04 — Concept note advisor — analysis only
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-AI-04 (PROPOSED).
- AI-04-AC1: Given an analyst supplies verified opportunity and project facts, when the user performs the operation described in this scenario, then an editable draft includes evidence-linked assumptions, missing questions, risks and fit rationale.
- AI-04-AC2: Given a draft is saved, when the user performs the operation described in this scenario, then it remains owner-scoped with audit events; no donor email, portal login, application submission or dispatch occurs.

### OFF-01 — Offline/installable app
Priority: MUST. Page: loading-error-empty-and-offline-states. Test: TEST-PROPOSED-OFF-01 (PROPOSED).
- OFF-01-AC1: Given the app shell was cached online, when the user performs the operation described in this scenario, then loss of connectivity opens the installable offline shell and labels cached data stale.
- OFF-01-AC2: Given an offline-eligible draft reconnects, when the user performs the operation described in this scenario, then idempotent sync reports success/conflict/failure without silent overwrite.

### OFF-02 — Offline security
Priority: MUST. Page: loading-error-empty-and-offline-states. Test: TEST-PROPOSED-OFF-02 (PROPOSED).
- OFF-02-AC1: Given a protected action requires server authorization/signature while offline, when the signature action is submitted, then the action is blocked with a connectivity explanation.
- OFF-02-AC2: Given identity is revoked/signed out or cache expiry passes, when the user attempts to activate or use the invitation, then protected cached content is inaccessible or cleared.

### MOB-01 — Mobile layout stack
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-MOB-01 (PROPOSED).
- MOB-01-AC1: Given viewport is 390×844, when the user performs the operation described in this scenario, then fixed/sticky bars occupy non-overlapping slots, content starts below the stack and primary actions remain visible.
- MOB-01-AC2: Given orientation/browser viewport changes or overlays open, when the record update is saved, then layout recalculates with no horizontal overflow and reachable controls.

### MOB-02 — Desktop layout stack
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-MOB-02 (PROPOSED).
- MOB-02-AC1: Given viewport is 1440×900, when the user performs the operation described in this scenario, then fixed/sticky elements do not overlap header, navigation, cards or action controls.
- MOB-02-AC2: Given long tables/cards are shown and viewport resizes, when the user performs the operation described in this scenario, then content remains reachable and focus indicators visible.

### GOV-01 — Backup/retention/DR
Priority: MUST. Page: release-readiness. Test: TEST-PROPOSED-GOV-01 (PROPOSED).
- GOV-01-AC1: Given a backup runs, when the user performs the operation described in this scenario, then encrypted integrity-checked metadata records timestamp, scope, expiry and restore-test status. Proposed default: daily backup, 30-day rolling retention, monthly restore test, RPO 24h, RTO 48h.
- GOV-01-AC2: Given restore/deletion is requested, when the user performs the operation described in this scenario, then the Board-approved retention/legal-hold policy and documented authorization govern the action and audit.

### TRC-01 — AC traceability
Priority: MUST. Page: release-readiness. Test: TEST-PROPOSED-TRC-01 (PROPOSED).
- TRC-01-AC1: Given a requirement is published, when the user performs the operation described in this scenario, then every AC has a unique ID, page/wireframe ID and test ID or explicit PROPOSED status.
- TRC-01-AC2: Given a module/route/page has no requirement, when the user performs the operation described in this scenario, then traceability audit lists it and release readiness fails until disposition.

### API-01 — Drive Gateway Worker: GET /health
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-01 (PROPOSED).
- API-01-AC1: Given a caller invokes GET /health on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-01-AC2: Given a request to GET /health is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-02 — Drive Gateway Worker: POST /oauth/start
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-02 (PROPOSED).
- API-02-AC1: Given a caller invokes POST /oauth/start on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-02-AC2: Given a request to POST /oauth/start is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-03 — Drive Gateway Worker: GET /oauth/callback
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-03 (PROPOSED).
- API-03-AC1: Given a caller invokes GET /oauth/callback on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-03-AC2: Given a request to GET /oauth/callback is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-04 — Drive Gateway Worker: GET/POST /api/system/release-readiness
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-04 (PROPOSED).
- API-04-AC1: Given a caller invokes GET/POST /api/system/release-readiness on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-04-AC2: Given a request to GET/POST /api/system/release-readiness is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-05 — Drive Gateway Worker: /api/communications/meta/*
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-05 (PROPOSED).
- API-05-AC1: Given a caller invokes /api/communications/meta/* on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-05-AC2: Given a request to /api/communications/meta/* is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-06 — Drive Gateway Worker: /api/communications/*
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-06 (PROPOSED).
- API-06-AC1: Given a caller invokes /api/communications/* on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-06-AC2: Given a request to /api/communications/* is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-07 — Drive Gateway Worker: /api/document-lifecycle/*
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-07 (PROPOSED).
- API-07-AC1: Given a caller invokes /api/document-lifecycle/* on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-07-AC2: Given a request to /api/document-lifecycle/* is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-08 — Drive Gateway Worker: POST /api/communication-media-archive/provision
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-08 (PROPOSED).
- API-08-AC1: Given a caller invokes POST /api/communication-media-archive/provision on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-08-AC2: Given a request to POST /api/communication-media-archive/provision is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-09 — Drive Gateway Worker: POST /api/research-archive/provision
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-09 (PROPOSED).
- API-09-AC1: Given a caller invokes POST /api/research-archive/provision on Drive Gateway Worker with valid method, input and required authentication, when the search filters are submitted, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-09-AC2: Given a request to POST /api/research-archive/provision is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-10 — Drive Gateway Worker: POST /api/upload
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-10 (PROPOSED).
- API-10-AC1: Given a caller invokes POST /api/upload on Drive Gateway Worker with valid method, input and required authentication, when the upload is submitted for storage, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-10-AC2: Given a request to POST /api/upload is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-11 — Drive Gateway Worker: POST /api/upload-controlled-document/policy-check
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-11 (PROPOSED).
- API-11-AC1: Given a caller invokes POST /api/upload-controlled-document/policy-check on Drive Gateway Worker with valid method, input and required authentication, when the upload is submitted for storage, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-11-AC2: Given a request to POST /api/upload-controlled-document/policy-check is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-12 — Drive Gateway Worker: POST /api/upload-controlled-document/register
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-12 (PROPOSED).
- API-12-AC1: Given a caller invokes POST /api/upload-controlled-document/register on Drive Gateway Worker with valid method, input and required authentication, when the upload is submitted for storage, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-12-AC2: Given a request to POST /api/upload-controlled-document/register is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-13 — Drive Gateway Worker: POST /api/upload-controlled-document
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-13 (PROPOSED).
- API-13-AC1: Given a caller invokes POST /api/upload-controlled-document on Drive Gateway Worker with valid method, input and required authentication, when the upload is submitted for storage, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-13-AC2: Given a request to POST /api/upload-controlled-document is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-14 — Drive Gateway Worker: POST /api/signature-pathway/reconcile
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-14 (PROPOSED).
- API-14-AC1: Given a caller invokes POST /api/signature-pathway/reconcile on Drive Gateway Worker with valid method, input and required authentication, when the signature action is submitted, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-14-AC2: Given a request to POST /api/signature-pathway/reconcile is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-15 — Drive Gateway Worker: GET /api/signature-workflow/list
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-15 (PROPOSED).
- API-15-AC1: Given a caller invokes GET /api/signature-workflow/list on Drive Gateway Worker with valid method, input and required authentication, when the signature action is submitted, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-15-AC2: Given a request to GET /api/signature-workflow/list is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-16 — Drive Gateway Worker: GET /api/signature-workflow/view
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-16 (PROPOSED).
- API-16-AC1: Given a caller invokes GET /api/signature-workflow/view on Drive Gateway Worker with valid method, input and required authentication, when the signature action is submitted, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-16-AC2: Given a request to GET /api/signature-workflow/view is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-17 — Drive Gateway Worker: POST /api/signature-workflow/add-signer-dry-run
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-17 (PROPOSED).
- API-17-AC1: Given a caller invokes POST /api/signature-workflow/add-signer-dry-run on Drive Gateway Worker with valid method, input and required authentication, when the signature action is submitted, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-17-AC2: Given a request to POST /api/signature-workflow/add-signer-dry-run is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-18 — Drive Gateway Worker: POST /api/signature-workflow/draft
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-18 (PROPOSED).
- API-18-AC1: Given a caller invokes POST /api/signature-workflow/draft on Drive Gateway Worker with valid method, input and required authentication, when the signature action is submitted, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-18-AC2: Given a request to POST /api/signature-workflow/draft is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-19 — Drive Gateway Worker: GET /api/system/diagnostics
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-19 (PROPOSED).
- API-19-AC1: Given a caller invokes GET /api/system/diagnostics on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-19-AC2: Given a request to GET /api/system/diagnostics is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-20 — Drive Gateway Worker: GET/POST /api/system/actual-data-access
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-20 (PROPOSED).
- API-20-AC1: Given a caller invokes GET/POST /api/system/actual-data-access on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-20-AC2: Given a request to GET/POST /api/system/actual-data-access is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-21 — Drive Gateway Worker: POST /api/members/reconcile-registered-identity-uids
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-21 (PROPOSED).
- API-21-AC1: Given a caller invokes POST /api/members/reconcile-registered-identity-uids on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-21-AC2: Given a request to POST /api/members/reconcile-registered-identity-uids is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-22 — Drive Gateway Worker: POST /api/signature/authority
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-22 (PROPOSED).
- API-22-AC1: Given a caller invokes POST /api/signature/authority on Drive Gateway Worker with valid method, input and required authentication, when the signature action is submitted, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-22-AC2: Given a request to POST /api/signature/authority is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-23 — Drive Gateway Worker: POST /api/signature-profile/folder
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-23 (PROPOSED).
- API-23-AC1: Given a caller invokes POST /api/signature-profile/folder on Drive Gateway Worker with valid method, input and required authentication, when the signature action is submitted, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-23-AC2: Given a request to POST /api/signature-profile/folder is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-24 — Drive Gateway Worker: POST /api/signature-profile/finalize
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-24 (PROPOSED).
- API-24-AC1: Given a caller invokes POST /api/signature-profile/finalize on Drive Gateway Worker with valid method, input and required authentication, when the signature action is submitted, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-24-AC2: Given a request to POST /api/signature-profile/finalize is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-25 — Drive Gateway Worker: POST /api/document-archive/folder
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-25 (PROPOSED).
- API-25-AC1: Given a caller invokes POST /api/document-archive/folder on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-25-AC2: Given a request to POST /api/document-archive/folder is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-26 — Drive Gateway Worker: POST /api/document-archive/provision
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-26 (PROPOSED).
- API-26-AC1: Given a caller invokes POST /api/document-archive/provision on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-26-AC2: Given a request to POST /api/document-archive/provision is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-27 — Drive Gateway Worker: POST /api/meeting-archive/provision
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-27 (PROPOSED).
- API-27-AC1: Given a caller invokes POST /api/meeting-archive/provision on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-27-AC2: Given a request to POST /api/meeting-archive/provision is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-28 — Drive Gateway Worker: POST /api/meeting-archive/get
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-28 (PROPOSED).
- API-28-AC1: Given a caller invokes POST /api/meeting-archive/get on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-28-AC2: Given a request to POST /api/meeting-archive/get is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-29 — Drive Gateway Worker: POST /api/signed-document/archive
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-29 (PROPOSED).
- API-29-AC1: Given a caller invokes POST /api/signed-document/archive on Drive Gateway Worker with valid method, input and required authentication, when the signature action is submitted, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-29-AC2: Given a request to POST /api/signed-document/archive is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-30 — Drive Gateway Worker: POST /api/signature-workflow/folder
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-30 (PROPOSED).
- API-30-AC1: Given a caller invokes POST /api/signature-workflow/folder on Drive Gateway Worker with valid method, input and required authentication, when the signature action is submitted, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-30-AC2: Given a request to POST /api/signature-workflow/folder is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-31 — Drive Gateway Worker: POST /api/signature-file/download
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-31 (PROPOSED).
- API-31-AC1: Given a caller invokes POST /api/signature-file/download on Drive Gateway Worker with valid method, input and required authentication, when the signature action is submitted, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-31-AC2: Given a request to POST /api/signature-file/download is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-32 — Drive Gateway Worker: POST /api/download
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-32 (PROPOSED).
- API-32-AC1: Given a caller invokes POST /api/download on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-32-AC2: Given a request to POST /api/download is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-33 — Drive Gateway Worker: POST /api/delete
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-33 (PROPOSED).
- API-33-AC1: Given a caller invokes POST /api/delete on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-33-AC2: Given a request to POST /api/delete is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-34 — Drive Gateway Worker: POST /api/invitations/redeem
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-34 (PROPOSED).
- API-34-AC1: Given a caller invokes POST /api/invitations/redeem on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-34-AC2: Given a request to POST /api/invitations/redeem is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-35 — Drive Gateway Worker: POST /api/invitations/session-state
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-35 (PROPOSED).
- API-35-AC1: Given a caller invokes POST /api/invitations/session-state on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-35-AC2: Given a request to POST /api/invitations/session-state is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-36 — Drive Gateway Worker: POST /api/invitations/password-set
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-36 (PROPOSED).
- API-36-AC1: Given a caller invokes POST /api/invitations/password-set on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-36-AC2: Given a request to POST /api/invitations/password-set is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-37 — Drive Gateway Worker: POST /api/send-invitation-email
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-37 (PROPOSED).
- API-37-AC1: Given a caller invokes POST /api/send-invitation-email on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-37-AC2: Given a request to POST /api/send-invitation-email is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-38 — Drive Gateway Worker: POST /api/invitations/send
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-38 (PROPOSED).
- API-38-AC1: Given a caller invokes POST /api/invitations/send on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-38-AC2: Given a request to POST /api/invitations/send is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-39 — Drive Gateway Worker: POST /api/signature-invitations/send
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-39 (PROPOSED).
- API-39-AC1: Given a caller invokes POST /api/signature-invitations/send on Drive Gateway Worker with valid method, input and required authentication, when the signature action is submitted, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-39-AC2: Given a request to POST /api/signature-invitations/send is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-40 — Drive Gateway Worker: POST /api/induction/lookup
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-40 (PROPOSED).
- API-40-AC1: Given a caller invokes POST /api/induction/lookup on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-40-AC2: Given a request to POST /api/induction/lookup is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-41 — Drive Gateway Worker: POST /api/session/profile
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-41 (PROPOSED).
- API-41-AC1: Given a caller invokes POST /api/session/profile on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-41-AC2: Given a request to POST /api/session/profile is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-42 — Drive Gateway Worker: POST /api/esign/cleanup
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-42 (PROPOSED).
- API-42-AC1: Given a caller invokes POST /api/esign/cleanup on Drive Gateway Worker with valid method, input and required authentication, when the signature action is submitted, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-42-AC2: Given a request to POST /api/esign/cleanup is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-43 — Drive Gateway Worker: GET/POST /api/documents/*
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-43 (PROPOSED).
- API-43-AC1: Given a caller invokes GET/POST /api/documents/* on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-43-AC2: Given a request to GET/POST /api/documents/* is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-44 — Drive Gateway Worker: GET/POST /api/envelopes/{id}[/{status|resync|retry|retry-completion|void}]
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-44 (PROPOSED).
- API-44-AC1: Given a caller invokes GET/POST /api/envelopes/{id}[/{status|resync|retry|retry-completion|void}] on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-44-AC2: Given a request to GET/POST /api/envelopes/{id}[/{status|resync|retry|retry-completion|void}] is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-45 — Drive Gateway Worker: GET/POST /api/sign/*
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-45 (PROPOSED).
- API-45-AC1: Given a caller invokes GET/POST /api/sign/* on Drive Gateway Worker with valid method, input and required authentication, when the signature action is submitted, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-45-AC2: Given a request to GET/POST /api/sign/* is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-46 — Drive Gateway Worker: GET/POST /api/auth/*
Priority: MUST. Page: application-shell-and-global-navigation. Test: TEST-PROPOSED-API-46 (PROPOSED).
- API-46-AC1: Given a caller invokes GET/POST /api/auth/* on Drive Gateway Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-46-AC2: Given a request to GET/POST /api/auth/* is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-47 — Grant crawler parallel Worker: GET /health
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-API-47 (PROPOSED).
- API-47-AC1: Given a caller invokes GET /health on Grant crawler parallel Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-47-AC2: Given a request to GET /health is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-48 — Grant crawler parallel Worker: GET /opportunities
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-API-48 (PROPOSED).
- API-48-AC1: Given a caller invokes GET /opportunities on Grant crawler parallel Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-48-AC2: Given a request to GET /opportunities is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-49 — Grant crawler parallel Worker: POST /run
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-API-49 (PROPOSED).
- API-49-AC1: Given a caller invokes POST /run on Grant crawler parallel Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-49-AC2: Given a request to POST /run is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-50 — Grant crawler parallel Worker: POST /assistant/analyze
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-API-50 (PROPOSED).
- API-50-AC1: Given a caller invokes POST /assistant/analyze on Grant crawler parallel Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-50-AC2: Given a request to POST /assistant/analyze is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-51 — Grant crawler parallel Worker: GET /application/drafts
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-API-51 (PROPOSED).
- API-51-AC1: Given a caller invokes GET /application/drafts on Grant crawler parallel Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-51-AC2: Given a request to GET /application/drafts is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-52 — Grant crawler parallel Worker: POST /application/drafts
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-API-52 (PROPOSED).
- API-52-AC1: Given a caller invokes POST /application/drafts on Grant crawler parallel Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-52-AC2: Given a request to POST /application/drafts is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-53 — Grant crawler parallel Worker: GET /application/drafts/{id}/events
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-API-53 (PROPOSED).
- API-53-AC1: Given a caller invokes GET /application/drafts/{id}/events on Grant crawler parallel Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-53-AC2: Given a request to GET /application/drafts/{id}/events is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-54 — Grant crawler parallel Worker: GET /, /application, /application/drafts/*
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-API-54 (PROPOSED).
- API-54-AC1: Given a caller invokes GET /, /application, /application/drafts/* on Grant crawler parallel Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-54-AC2: Given a request to GET /, /application, /application/drafts/* is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-55 — Grant crawler parallel Worker: POST /crawl
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-API-55 (PROPOSED).
- API-55-AC1: Given a caller invokes POST /crawl on Grant crawler parallel Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-55-AC2: Given a request to POST /crawl is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-56 — Grant crawler parallel Worker: POST /fundraising/search
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-API-56 (PROPOSED).
- API-56-AC1: Given a caller invokes POST /fundraising/search on Grant crawler parallel Worker with valid method, input and required authentication, when the search filters are submitted, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-56-AC2: Given a request to POST /fundraising/search is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-57 — Grant crawler Worker: GET /health
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-API-57 (PROPOSED).
- API-57-AC1: Given a caller invokes GET /health on Grant crawler Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-57-AC2: Given a request to GET /health is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-58 — Grant crawler Worker: GET /opportunities
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-API-58 (PROPOSED).
- API-58-AC1: Given a caller invokes GET /opportunities on Grant crawler Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-58-AC2: Given a request to GET /opportunities is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

### API-59 — Grant crawler Worker: scheduled cron
Priority: MUST. Page: grant-intelligence-and-funding-opportunities. Test: TEST-PROPOSED-API-59 (PROPOSED).
- API-59-AC1: Given a caller invokes scheduled cron on Grant crawler Worker with valid method, input and required authentication, when the user performs the operation described in this scenario, then the handler returns its documented success response and performs only the operation assigned to this route.
- API-59-AC2: Given a request to scheduled cron is unauthorized, malformed, unsupported or outside scope, when the protected request is submitted directly to the server, then the handler returns a controlled 4xx response, exposes no protected data and performs no unauthorized mutation.

## Backup, retention and disaster recovery
**TO BE APPROVED BY IRPA MANAGEMENT.** Proposed default only: daily encrypted backup; 30-day rolling retention; monthly restore test; RPO 24 hours; RTO 48 hours. Management approval is required for retention, legal hold, backup scope/frequency, encryption/key custody, restore testing, RPO/RTO and DR location. No policy or production behavior is changed by this SRS.

## Non-functional requirements
- Security: least privilege, server-side authorization, secure token handling, no secrets in client output, auditable mutations and denials.
- Integrity: idempotent offline retries; no duplicate votes, invitation redemptions or collection records.
- Availability: partial failures are surfaced and never reported as success.
- Accessibility: WCAG 2.2 AA proposed; IRPA Management approval required.
- Performance: no approved p95/API/load target found; baseline and target remain open.
- Privacy: classify records, minimize sensitive cache, apply consent/legal basis to research collection and preserve provenance.
- Integrations: Firebase, Cloudflare Workers, Google Drive, WordPress/cPanel, SMTP, social and LiveKit are separate boundaries; no live health claim is made.

## Traceability: requirement → page → test → acceptance criterion
| Requirement | Page | Test ID | Acceptance criterion | Status |
|---|---|---|---|---|
| MOD-01 | it-operations | TEST-PROPOSED-MOD-01 | MOD-01-AC1 | PROPOSED |
| MOD-01 | it-operations | TEST-PROPOSED-MOD-01 | MOD-01-AC2 | PROPOSED |
| MOD-02 | dashboard | TEST-PROPOSED-MOD-02 | MOD-02-AC1 | PROPOSED |
| MOD-02 | dashboard | TEST-PROPOSED-MOD-02 | MOD-02-AC2 | PROPOSED |
| MOD-03 | induction-and-orientation | TEST-PROPOSED-MOD-03 | MOD-03-AC1 | PROPOSED |
| MOD-03 | induction-and-orientation | TEST-PROPOSED-MOD-03 | MOD-03-AC2 | PROPOSED |
| MOD-04 | induction-applications | TEST-PROPOSED-MOD-04 | MOD-04-AC1 | PROPOSED |
| MOD-04 | induction-applications | TEST-PROPOSED-MOD-04 | MOD-04-AC2 | PROPOSED |
| MOD-05 | board-members-registration | TEST-PROPOSED-MOD-05 | MOD-05-AC1 | PROPOSED |
| MOD-05 | board-members-registration | TEST-PROPOSED-MOD-05 | MOD-05-AC2 | PROPOSED |
| MOD-06 | members-and-personnel | TEST-PROPOSED-MOD-06 | MOD-06-AC1 | PROPOSED |
| MOD-06 | members-and-personnel | TEST-PROPOSED-MOD-06 | MOD-06-AC2 | PROPOSED |
| MOD-07 | invitations | TEST-PROPOSED-MOD-07 | MOD-07-AC1 | PROPOSED |
| MOD-07 | invitations | TEST-PROPOSED-MOD-07 | MOD-07-AC2 | PROPOSED |
| MOD-08 | meetings | TEST-PROPOSED-MOD-08 | MOD-08-AC1 | PROPOSED |
| MOD-08 | meetings | TEST-PROPOSED-MOD-08 | MOD-08-AC2 | PROPOSED |
| MOD-09 | resolutions | TEST-PROPOSED-MOD-09 | MOD-09-AC1 | PROPOSED |
| MOD-09 | resolutions | TEST-PROPOSED-MOD-09 | MOD-09-AC2 | PROPOSED |
| MOD-10 | voting | TEST-PROPOSED-MOD-10 | MOD-10-AC1 | PROPOSED |
| MOD-10 | voting | TEST-PROPOSED-MOD-10 | MOD-10-AC2 | PROPOSED |
| MOD-11 | actions | TEST-PROPOSED-MOD-11 | MOD-11-AC1 | PROPOSED |
| MOD-11 | actions | TEST-PROPOSED-MOD-11 | MOD-11-AC2 | PROPOSED |
| MOD-12 | documents | TEST-PROPOSED-MOD-12 | MOD-12-AC1 | PROPOSED |
| MOD-12 | documents | TEST-PROPOSED-MOD-12 | MOD-12-AC2 | PROPOSED |
| MOD-13 | signature-platform | TEST-PROPOSED-MOD-13 | MOD-13-AC1 | PROPOSED |
| MOD-13 | signature-platform | TEST-PROPOSED-MOD-13 | MOD-13-AC2 | PROPOSED |
| MOD-14 | decisions | TEST-PROPOSED-MOD-14 | MOD-14-AC1 | PROPOSED |
| MOD-14 | decisions | TEST-PROPOSED-MOD-14 | MOD-14-AC2 | PROPOSED |
| MOD-15 | risk-register | TEST-PROPOSED-MOD-15 | MOD-15-AC1 | PROPOSED |
| MOD-15 | risk-register | TEST-PROPOSED-MOD-15 | MOD-15-AC2 | PROPOSED |
| MOD-16 | authorization-and-approvals | TEST-PROPOSED-MOD-16 | MOD-16-AC1 | PROPOSED |
| MOD-16 | authorization-and-approvals | TEST-PROPOSED-MOD-16 | MOD-16-AC2 | PROPOSED |
| MOD-17 | employee-payments | TEST-PROPOSED-MOD-17 | MOD-17-AC1 | PROPOSED |
| MOD-17 | employee-payments | TEST-PROPOSED-MOD-17 | MOD-17-AC2 | PROPOSED |
| MOD-18 | research-statistics-and-knowledge | TEST-PROPOSED-MOD-18 | MOD-18-AC1 | PROPOSED |
| MOD-18 | research-statistics-and-knowledge | TEST-PROPOSED-MOD-18 | MOD-18-AC2 | PROPOSED |
| MOD-19 | finance-portfolio | TEST-PROPOSED-MOD-19 | MOD-19-AC1 | PROPOSED |
| MOD-19 | finance-portfolio | TEST-PROPOSED-MOD-19 | MOD-19-AC2 | PROPOSED |
| MOD-20 | procurement | TEST-PROPOSED-MOD-20 | MOD-20-AC1 | PROPOSED |
| MOD-20 | procurement | TEST-PROPOSED-MOD-20 | MOD-20-AC2 | PROPOSED |
| MOD-21 | reports | TEST-PROPOSED-MOD-21 | MOD-21-AC1 | PROPOSED |
| MOD-21 | reports | TEST-PROPOSED-MOD-21 | MOD-21-AC2 | PROPOSED |
| MOD-22 | audit-trail | TEST-PROPOSED-MOD-22 | MOD-22-AC1 | PROPOSED |
| MOD-22 | audit-trail | TEST-PROPOSED-MOD-22 | MOD-22-AC2 | PROPOSED |
| MOD-23 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-MOD-23 | MOD-23-AC1 | PROPOSED |
| MOD-23 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-MOD-23 | MOD-23-AC2 | PROPOSED |
| MOD-24 | communication-and-media | TEST-PROPOSED-MOD-24 | MOD-24-AC1 | PROPOSED |
| MOD-24 | communication-and-media | TEST-PROPOSED-MOD-24 | MOD-24-AC2 | PROPOSED |
| MOD-25 | downloads | TEST-PROPOSED-MOD-25 | MOD-25-AC1 | PROPOSED |
| MOD-25 | downloads | TEST-PROPOSED-MOD-25 | MOD-25-AC2 | PROPOSED |
| MOD-26 | settings | TEST-PROPOSED-MOD-26 | MOD-26-AC1 | PROPOSED |
| MOD-26 | settings | TEST-PROPOSED-MOD-26 | MOD-26-AC2 | PROPOSED |
| MOD-27 | add-administrator | TEST-PROPOSED-MOD-27 | MOD-27-AC1 | PROPOSED |
| MOD-27 | add-administrator | TEST-PROPOSED-MOD-27 | MOD-27-AC2 | PROPOSED |
| MOD-28 | department-and-archive-registry | TEST-PROPOSED-MOD-28 | MOD-28-AC1 | PROPOSED |
| MOD-28 | department-and-archive-registry | TEST-PROPOSED-MOD-28 | MOD-28-AC2 | PROPOSED |
| MOD-29 | department-portal-builder | TEST-PROPOSED-MOD-29 | MOD-29-AC1 | PROPOSED |
| MOD-29 | department-portal-builder | TEST-PROPOSED-MOD-29 | MOD-29-AC2 | PROPOSED |
| MOD-30 | external-auditor-portal | TEST-PROPOSED-MOD-30 | MOD-30-AC1 | PROPOSED |
| MOD-30 | external-auditor-portal | TEST-PROPOSED-MOD-30 | MOD-30-AC2 | PROPOSED |
| MOD-31 | auditors-and-special-invitees | TEST-PROPOSED-MOD-31 | MOD-31-AC1 | PROPOSED |
| MOD-31 | auditors-and-special-invitees | TEST-PROPOSED-MOD-31 | MOD-31-AC2 | PROPOSED |
| SUB-01 | meetings-meeting-room | TEST-PROPOSED-SUB-01 | SUB-01-AC1 | PROPOSED |
| SUB-01 | meetings-meeting-room | TEST-PROPOSED-SUB-01 | SUB-01-AC2 | PROPOSED |
| SUB-02 | meetings-participants | TEST-PROPOSED-SUB-02 | SUB-02-AC1 | PROPOSED |
| SUB-02 | meetings-participants | TEST-PROPOSED-SUB-02 | SUB-02-AC2 | PROPOSED |
| SUB-03 | meetings-resolutions | TEST-PROPOSED-SUB-03 | SUB-03-AC1 | PROPOSED |
| SUB-03 | meetings-resolutions | TEST-PROPOSED-SUB-03 | SUB-03-AC2 | PROPOSED |
| SUB-04 | meetings-voting | TEST-PROPOSED-SUB-04 | SUB-04-AC1 | PROPOSED |
| SUB-04 | meetings-voting | TEST-PROPOSED-SUB-04 | SUB-04-AC2 | PROPOSED |
| SUB-05 | meetings-actions | TEST-PROPOSED-SUB-05 | SUB-05-AC1 | PROPOSED |
| SUB-05 | meetings-actions | TEST-PROPOSED-SUB-05 | SUB-05-AC2 | PROPOSED |
| SUB-06 | meetings-decisions | TEST-PROPOSED-SUB-06 | SUB-06-AC1 | PROPOSED |
| SUB-06 | meetings-decisions | TEST-PROPOSED-SUB-06 | SUB-06-AC2 | PROPOSED |
| SUB-07 | documents-my-documents | TEST-PROPOSED-SUB-07 | SUB-07-AC1 | PROPOSED |
| SUB-07 | documents-my-documents | TEST-PROPOSED-SUB-07 | SUB-07-AC2 | PROPOSED |
| SUB-08 | documents-department-documents | TEST-PROPOSED-SUB-08 | SUB-08-AC1 | PROPOSED |
| SUB-08 | documents-department-documents | TEST-PROPOSED-SUB-08 | SUB-08-AC2 | PROPOSED |
| SUB-09 | documents-shared-with-me | TEST-PROPOSED-SUB-09 | SUB-09-AC1 | PROPOSED |
| SUB-09 | documents-shared-with-me | TEST-PROPOSED-SUB-09 | SUB-09-AC2 | PROPOSED |
| SUB-10 | documents-signing-workspace | TEST-PROPOSED-SUB-10 | SUB-10-AC1 | PROPOSED |
| SUB-10 | documents-signing-workspace | TEST-PROPOSED-SUB-10 | SUB-10-AC2 | PROPOSED |
| SUB-11 | documents-post-signature-work | TEST-PROPOSED-SUB-11 | SUB-11-AC1 | PROPOSED |
| SUB-11 | documents-post-signature-work | TEST-PROPOSED-SUB-11 | SUB-11-AC2 | PROPOSED |
| SUB-12 | documents-final-archive | TEST-PROPOSED-SUB-12 | SUB-12-AC1 | PROPOSED |
| SUB-12 | documents-final-archive | TEST-PROPOSED-SUB-12 | SUB-12-AC2 | PROPOSED |
| SUB-13 | documents-upload-document | TEST-PROPOSED-SUB-13 | SUB-13-AC1 | PROPOSED |
| SUB-13 | documents-upload-document | TEST-PROPOSED-SUB-13 | SUB-13-AC2 | PROPOSED |
| SUB-14 | documents-retrieve-archived-documents | TEST-PROPOSED-SUB-14 | SUB-14-AC1 | PROPOSED |
| SUB-14 | documents-retrieve-archived-documents | TEST-PROPOSED-SUB-14 | SUB-14-AC2 | PROPOSED |
| SUB-15 | induction-and-orientation-induction-applications | TEST-PROPOSED-SUB-15 | SUB-15-AC1 | PROPOSED |
| SUB-15 | induction-and-orientation-induction-applications | TEST-PROPOSED-SUB-15 | SUB-15-AC2 | PROPOSED |
| STD-01 | dataset-registry | TEST-PROPOSED-STD-01 | STD-01-AC1 | PROPOSED |
| STD-01 | dataset-registry | TEST-PROPOSED-STD-01 | STD-01-AC2 | PROPOSED |
| STD-02 | research-data-collection | TEST-PROPOSED-STD-02 | STD-02-AC1 | PROPOSED |
| STD-02 | research-data-collection | TEST-PROPOSED-STD-02 | STD-02-AC2 | PROPOSED |
| STD-03 | release-readiness | TEST-PROPOSED-STD-03 | STD-03-AC1 | PROPOSED |
| STD-03 | release-readiness | TEST-PROPOSED-STD-03 | STD-03-AC2 | PROPOSED |
| AI-01 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-AI-01 | AI-01-AC1 | PROPOSED |
| AI-01 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-AI-01 | AI-01-AC2 | PROPOSED |
| AI-02 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-AI-02 | AI-02-AC1 | PROPOSED |
| AI-02 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-AI-02 | AI-02-AC2 | PROPOSED |
| AI-03 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-AI-03 | AI-03-AC1 | PROPOSED |
| AI-03 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-AI-03 | AI-03-AC2 | PROPOSED |
| AI-04 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-AI-04 | AI-04-AC1 | PROPOSED |
| AI-04 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-AI-04 | AI-04-AC2 | PROPOSED |
| OFF-01 | loading-error-empty-and-offline-states | TEST-PROPOSED-OFF-01 | OFF-01-AC1 | PROPOSED |
| OFF-01 | loading-error-empty-and-offline-states | TEST-PROPOSED-OFF-01 | OFF-01-AC2 | PROPOSED |
| OFF-02 | loading-error-empty-and-offline-states | TEST-PROPOSED-OFF-02 | OFF-02-AC1 | PROPOSED |
| OFF-02 | loading-error-empty-and-offline-states | TEST-PROPOSED-OFF-02 | OFF-02-AC2 | PROPOSED |
| MOB-01 | application-shell-and-global-navigation | TEST-PROPOSED-MOB-01 | MOB-01-AC1 | PROPOSED |
| MOB-01 | application-shell-and-global-navigation | TEST-PROPOSED-MOB-01 | MOB-01-AC2 | PROPOSED |
| MOB-02 | application-shell-and-global-navigation | TEST-PROPOSED-MOB-02 | MOB-02-AC1 | PROPOSED |
| MOB-02 | application-shell-and-global-navigation | TEST-PROPOSED-MOB-02 | MOB-02-AC2 | PROPOSED |
| GOV-01 | release-readiness | TEST-PROPOSED-GOV-01 | GOV-01-AC1 | PROPOSED |
| GOV-01 | release-readiness | TEST-PROPOSED-GOV-01 | GOV-01-AC2 | PROPOSED |
| TRC-01 | release-readiness | TEST-PROPOSED-TRC-01 | TRC-01-AC1 | PROPOSED |
| TRC-01 | release-readiness | TEST-PROPOSED-TRC-01 | TRC-01-AC2 | PROPOSED |
| API-01 | application-shell-and-global-navigation | TEST-PROPOSED-API-01 | API-01-AC1 | PROPOSED |
| API-01 | application-shell-and-global-navigation | TEST-PROPOSED-API-01 | API-01-AC2 | PROPOSED |
| API-02 | application-shell-and-global-navigation | TEST-PROPOSED-API-02 | API-02-AC1 | PROPOSED |
| API-02 | application-shell-and-global-navigation | TEST-PROPOSED-API-02 | API-02-AC2 | PROPOSED |
| API-03 | application-shell-and-global-navigation | TEST-PROPOSED-API-03 | API-03-AC1 | PROPOSED |
| API-03 | application-shell-and-global-navigation | TEST-PROPOSED-API-03 | API-03-AC2 | PROPOSED |
| API-04 | application-shell-and-global-navigation | TEST-PROPOSED-API-04 | API-04-AC1 | PROPOSED |
| API-04 | application-shell-and-global-navigation | TEST-PROPOSED-API-04 | API-04-AC2 | PROPOSED |
| API-05 | application-shell-and-global-navigation | TEST-PROPOSED-API-05 | API-05-AC1 | PROPOSED |
| API-05 | application-shell-and-global-navigation | TEST-PROPOSED-API-05 | API-05-AC2 | PROPOSED |
| API-06 | application-shell-and-global-navigation | TEST-PROPOSED-API-06 | API-06-AC1 | PROPOSED |
| API-06 | application-shell-and-global-navigation | TEST-PROPOSED-API-06 | API-06-AC2 | PROPOSED |
| API-07 | application-shell-and-global-navigation | TEST-PROPOSED-API-07 | API-07-AC1 | PROPOSED |
| API-07 | application-shell-and-global-navigation | TEST-PROPOSED-API-07 | API-07-AC2 | PROPOSED |
| API-08 | application-shell-and-global-navigation | TEST-PROPOSED-API-08 | API-08-AC1 | PROPOSED |
| API-08 | application-shell-and-global-navigation | TEST-PROPOSED-API-08 | API-08-AC2 | PROPOSED |
| API-09 | application-shell-and-global-navigation | TEST-PROPOSED-API-09 | API-09-AC1 | PROPOSED |
| API-09 | application-shell-and-global-navigation | TEST-PROPOSED-API-09 | API-09-AC2 | PROPOSED |
| API-10 | application-shell-and-global-navigation | TEST-PROPOSED-API-10 | API-10-AC1 | PROPOSED |
| API-10 | application-shell-and-global-navigation | TEST-PROPOSED-API-10 | API-10-AC2 | PROPOSED |
| API-11 | application-shell-and-global-navigation | TEST-PROPOSED-API-11 | API-11-AC1 | PROPOSED |
| API-11 | application-shell-and-global-navigation | TEST-PROPOSED-API-11 | API-11-AC2 | PROPOSED |
| API-12 | application-shell-and-global-navigation | TEST-PROPOSED-API-12 | API-12-AC1 | PROPOSED |
| API-12 | application-shell-and-global-navigation | TEST-PROPOSED-API-12 | API-12-AC2 | PROPOSED |
| API-13 | application-shell-and-global-navigation | TEST-PROPOSED-API-13 | API-13-AC1 | PROPOSED |
| API-13 | application-shell-and-global-navigation | TEST-PROPOSED-API-13 | API-13-AC2 | PROPOSED |
| API-14 | application-shell-and-global-navigation | TEST-PROPOSED-API-14 | API-14-AC1 | PROPOSED |
| API-14 | application-shell-and-global-navigation | TEST-PROPOSED-API-14 | API-14-AC2 | PROPOSED |
| API-15 | application-shell-and-global-navigation | TEST-PROPOSED-API-15 | API-15-AC1 | PROPOSED |
| API-15 | application-shell-and-global-navigation | TEST-PROPOSED-API-15 | API-15-AC2 | PROPOSED |
| API-16 | application-shell-and-global-navigation | TEST-PROPOSED-API-16 | API-16-AC1 | PROPOSED |
| API-16 | application-shell-and-global-navigation | TEST-PROPOSED-API-16 | API-16-AC2 | PROPOSED |
| API-17 | application-shell-and-global-navigation | TEST-PROPOSED-API-17 | API-17-AC1 | PROPOSED |
| API-17 | application-shell-and-global-navigation | TEST-PROPOSED-API-17 | API-17-AC2 | PROPOSED |
| API-18 | application-shell-and-global-navigation | TEST-PROPOSED-API-18 | API-18-AC1 | PROPOSED |
| API-18 | application-shell-and-global-navigation | TEST-PROPOSED-API-18 | API-18-AC2 | PROPOSED |
| API-19 | application-shell-and-global-navigation | TEST-PROPOSED-API-19 | API-19-AC1 | PROPOSED |
| API-19 | application-shell-and-global-navigation | TEST-PROPOSED-API-19 | API-19-AC2 | PROPOSED |
| API-20 | application-shell-and-global-navigation | TEST-PROPOSED-API-20 | API-20-AC1 | PROPOSED |
| API-20 | application-shell-and-global-navigation | TEST-PROPOSED-API-20 | API-20-AC2 | PROPOSED |
| API-21 | application-shell-and-global-navigation | TEST-PROPOSED-API-21 | API-21-AC1 | PROPOSED |
| API-21 | application-shell-and-global-navigation | TEST-PROPOSED-API-21 | API-21-AC2 | PROPOSED |
| API-22 | application-shell-and-global-navigation | TEST-PROPOSED-API-22 | API-22-AC1 | PROPOSED |
| API-22 | application-shell-and-global-navigation | TEST-PROPOSED-API-22 | API-22-AC2 | PROPOSED |
| API-23 | application-shell-and-global-navigation | TEST-PROPOSED-API-23 | API-23-AC1 | PROPOSED |
| API-23 | application-shell-and-global-navigation | TEST-PROPOSED-API-23 | API-23-AC2 | PROPOSED |
| API-24 | application-shell-and-global-navigation | TEST-PROPOSED-API-24 | API-24-AC1 | PROPOSED |
| API-24 | application-shell-and-global-navigation | TEST-PROPOSED-API-24 | API-24-AC2 | PROPOSED |
| API-25 | application-shell-and-global-navigation | TEST-PROPOSED-API-25 | API-25-AC1 | PROPOSED |
| API-25 | application-shell-and-global-navigation | TEST-PROPOSED-API-25 | API-25-AC2 | PROPOSED |
| API-26 | application-shell-and-global-navigation | TEST-PROPOSED-API-26 | API-26-AC1 | PROPOSED |
| API-26 | application-shell-and-global-navigation | TEST-PROPOSED-API-26 | API-26-AC2 | PROPOSED |
| API-27 | application-shell-and-global-navigation | TEST-PROPOSED-API-27 | API-27-AC1 | PROPOSED |
| API-27 | application-shell-and-global-navigation | TEST-PROPOSED-API-27 | API-27-AC2 | PROPOSED |
| API-28 | application-shell-and-global-navigation | TEST-PROPOSED-API-28 | API-28-AC1 | PROPOSED |
| API-28 | application-shell-and-global-navigation | TEST-PROPOSED-API-28 | API-28-AC2 | PROPOSED |
| API-29 | application-shell-and-global-navigation | TEST-PROPOSED-API-29 | API-29-AC1 | PROPOSED |
| API-29 | application-shell-and-global-navigation | TEST-PROPOSED-API-29 | API-29-AC2 | PROPOSED |
| API-30 | application-shell-and-global-navigation | TEST-PROPOSED-API-30 | API-30-AC1 | PROPOSED |
| API-30 | application-shell-and-global-navigation | TEST-PROPOSED-API-30 | API-30-AC2 | PROPOSED |
| API-31 | application-shell-and-global-navigation | TEST-PROPOSED-API-31 | API-31-AC1 | PROPOSED |
| API-31 | application-shell-and-global-navigation | TEST-PROPOSED-API-31 | API-31-AC2 | PROPOSED |
| API-32 | application-shell-and-global-navigation | TEST-PROPOSED-API-32 | API-32-AC1 | PROPOSED |
| API-32 | application-shell-and-global-navigation | TEST-PROPOSED-API-32 | API-32-AC2 | PROPOSED |
| API-33 | application-shell-and-global-navigation | TEST-PROPOSED-API-33 | API-33-AC1 | PROPOSED |
| API-33 | application-shell-and-global-navigation | TEST-PROPOSED-API-33 | API-33-AC2 | PROPOSED |
| API-34 | application-shell-and-global-navigation | TEST-PROPOSED-API-34 | API-34-AC1 | PROPOSED |
| API-34 | application-shell-and-global-navigation | TEST-PROPOSED-API-34 | API-34-AC2 | PROPOSED |
| API-35 | application-shell-and-global-navigation | TEST-PROPOSED-API-35 | API-35-AC1 | PROPOSED |
| API-35 | application-shell-and-global-navigation | TEST-PROPOSED-API-35 | API-35-AC2 | PROPOSED |
| API-36 | application-shell-and-global-navigation | TEST-PROPOSED-API-36 | API-36-AC1 | PROPOSED |
| API-36 | application-shell-and-global-navigation | TEST-PROPOSED-API-36 | API-36-AC2 | PROPOSED |
| API-37 | application-shell-and-global-navigation | TEST-PROPOSED-API-37 | API-37-AC1 | PROPOSED |
| API-37 | application-shell-and-global-navigation | TEST-PROPOSED-API-37 | API-37-AC2 | PROPOSED |
| API-38 | application-shell-and-global-navigation | TEST-PROPOSED-API-38 | API-38-AC1 | PROPOSED |
| API-38 | application-shell-and-global-navigation | TEST-PROPOSED-API-38 | API-38-AC2 | PROPOSED |
| API-39 | application-shell-and-global-navigation | TEST-PROPOSED-API-39 | API-39-AC1 | PROPOSED |
| API-39 | application-shell-and-global-navigation | TEST-PROPOSED-API-39 | API-39-AC2 | PROPOSED |
| API-40 | application-shell-and-global-navigation | TEST-PROPOSED-API-40 | API-40-AC1 | PROPOSED |
| API-40 | application-shell-and-global-navigation | TEST-PROPOSED-API-40 | API-40-AC2 | PROPOSED |
| API-41 | application-shell-and-global-navigation | TEST-PROPOSED-API-41 | API-41-AC1 | PROPOSED |
| API-41 | application-shell-and-global-navigation | TEST-PROPOSED-API-41 | API-41-AC2 | PROPOSED |
| API-42 | application-shell-and-global-navigation | TEST-PROPOSED-API-42 | API-42-AC1 | PROPOSED |
| API-42 | application-shell-and-global-navigation | TEST-PROPOSED-API-42 | API-42-AC2 | PROPOSED |
| API-43 | application-shell-and-global-navigation | TEST-PROPOSED-API-43 | API-43-AC1 | PROPOSED |
| API-43 | application-shell-and-global-navigation | TEST-PROPOSED-API-43 | API-43-AC2 | PROPOSED |
| API-44 | application-shell-and-global-navigation | TEST-PROPOSED-API-44 | API-44-AC1 | PROPOSED |
| API-44 | application-shell-and-global-navigation | TEST-PROPOSED-API-44 | API-44-AC2 | PROPOSED |
| API-45 | application-shell-and-global-navigation | TEST-PROPOSED-API-45 | API-45-AC1 | PROPOSED |
| API-45 | application-shell-and-global-navigation | TEST-PROPOSED-API-45 | API-45-AC2 | PROPOSED |
| API-46 | application-shell-and-global-navigation | TEST-PROPOSED-API-46 | API-46-AC1 | PROPOSED |
| API-46 | application-shell-and-global-navigation | TEST-PROPOSED-API-46 | API-46-AC2 | PROPOSED |
| API-47 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-47 | API-47-AC1 | PROPOSED |
| API-47 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-47 | API-47-AC2 | PROPOSED |
| API-48 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-48 | API-48-AC1 | PROPOSED |
| API-48 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-48 | API-48-AC2 | PROPOSED |
| API-49 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-49 | API-49-AC1 | PROPOSED |
| API-49 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-49 | API-49-AC2 | PROPOSED |
| API-50 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-50 | API-50-AC1 | PROPOSED |
| API-50 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-50 | API-50-AC2 | PROPOSED |
| API-51 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-51 | API-51-AC1 | PROPOSED |
| API-51 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-51 | API-51-AC2 | PROPOSED |
| API-52 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-52 | API-52-AC1 | PROPOSED |
| API-52 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-52 | API-52-AC2 | PROPOSED |
| API-53 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-53 | API-53-AC1 | PROPOSED |
| API-53 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-53 | API-53-AC2 | PROPOSED |
| API-54 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-54 | API-54-AC1 | PROPOSED |
| API-54 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-54 | API-54-AC2 | PROPOSED |
| API-55 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-55 | API-55-AC1 | PROPOSED |
| API-55 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-55 | API-55-AC2 | PROPOSED |
| API-56 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-56 | API-56-AC1 | PROPOSED |
| API-56 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-56 | API-56-AC2 | PROPOSED |
| API-57 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-57 | API-57-AC1 | PROPOSED |
| API-57 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-57 | API-57-AC2 | PROPOSED |
| API-58 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-58 | API-58-AC1 | PROPOSED |
| API-58 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-58 | API-58-AC2 | PROPOSED |
| API-59 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-59 | API-59-AC1 | PROPOSED |
| API-59 | grant-intelligence-and-funding-opportunities | TEST-PROPOSED-API-59 | API-59-AC2 | PROPOSED |

## Inspection gaps
- Initial PR head contained only VALIDATION.md; SRS, exports and wireframes described in its PR body were absent.
- All 31 modules, 15 sub-portals and 59 explicit Worker paths/families lacked requirement IDs in PR artifacts.
- No existing acceptance-criteria corpus was available to assess for vagueness; the earlier claim of 55 requirements lacked an SRS artifact on PR head.
- 59 top-level route/path families now have API IDs; delegated nested router modules and historic 66-route count require exhaustive path/schema/auth extraction.
- Standalone portal navigation is proposed, not asserted as source-implemented.
- Tests are proposed, not claimed implemented or passing; role/action matrix, offline cache expiry, integration health and live app remain unverified.

## Open decisions
1. Approve 31 top-level modules and 15 nested sub-portals.
2. Confirm three standalone portals and assign owners.
3. Approve role register and role × module × action matrix.
4. **TO BE APPROVED BY IRPA MANAGEMENT:** retention/legal hold, backup, encryption/key custody, RPO/RTO and DR; review proposed defaults.
6. Approve offline cache classes, expiry, revocation and sync conflict policy.
7. Approve WCAG 2.2 AA and performance/load targets.
8. Confirm Actual/Trial gate and temporary gateway-disconnect flag owners.
9. Complete delegated Gateway router enumeration, schemas, auth policy and executable tests.
10. Schedule authenticated live-app and integration acceptance testing.


## Owner decisions — normative corrections (31 October 2026)

These decisions supersede any conflicting descriptive text, diagrams, or inferred role mappings elsewhere in this specification.

### Governance boundary and grant workflow

Grant Intelligence & Funding Opportunities (MOD-23), donor/funder research, concept-note preparation, funding opportunities, and the funding functions embedded in Communication & Media (MOD-24) are management/fundraising functions. These records remain within the Executive Director-led management approval state machine and are never routed to governance meeting, resolution, voting, signature or approval queues.

**Grant workflow:** (1) authorised fundraising/management staff prepare and maintain opportunity analysis, eligibility evidence, donor alignment and concept-note drafts; (2) the Executive Director reviews and approves or returns the draft with reasons; (3) external submission is performed outside this system. The system is limited to discovery and analysis at this stage and must not submit applications or contact donors. The approval state shown in the UI is an internal management decision only.

### Role and access matrix — grant and governance boundary

| Role | Grant discovery and analysis | Prepare concept note / funding application draft | Executive Director approval / return authority for grant or concept note | Communication & Media funding tools | Separate governance scope |
|---|---|---|---|---|---|
| Administrator | Administrative configuration and authorised access provisioning; no grant approval authority; approval authority belongs exclusively to the Executive Director | No approval authority; may have access only if separately assigned fundraising duties | **No** | Administrative configuration; no grant approval authority | System administration only |
| Authorised Fundraising / Management Staff | **Yes** — discovery, eligibility evidence, donor alignment, analysis | **Yes** — prepare and revise internal drafts | **No** — submit to Executive Director | **Yes** — prepare funding-related records and drafts | No governance decision, vote or signature authority by virtue of this role |
| Executive Director | Read/review management pipeline | Review submitted internal drafts; may request revisions | **Yes** — approve or return with recorded rationale and timestamp | **Yes** — approve or return funding-related records/drafts | Governance rights only where separately assigned under the separate governance role register |

| Communications Officer | No grant approval; approval authority belongs exclusively to the Executive Director; only access to assigned communication work | No grant application approval | **No** | Content/channel operations; funding records only if separately assigned as authorised management staff | No governance decision authority |
| Auditor | Read-only evidence access where specifically authorised; no workflow action | No | **No** | Read-only audit evidence where specifically authorised | Read-only governance evidence within audit scope |

Access is least-privilege and enforced server-side. A person holding multiple assigned roles receives only the union of explicitly assigned permissions; a Board role never implies fundraising access or vice versa. The Executive Director approval permission is explicit and cannot be inferred from Administrator status.

### Grant requirements and acceptance criteria

- **GR-01 — Staff preparation.** Given an authenticated user has an assigned Fundraising/Management Staff permission, when that user creates or edits an opportunity analysis or concept-note draft, then the system records the author, timestamp, version, source evidence and status and permits only internal preparation actions.
- **GR-02 — Executive Director approval.** Given a complete internal grant/concept-note draft is submitted for approval, when the Executive Director opens the approval task and selects Approve or Return, then the system records the Executive Director identity, decision, rationale, timestamp and immutable history and changes the status to Approved or Returned.
- **GR-03 — Awaiting Executive Director approval.** Given authorised staff submit a draft for review, when the submission is saved, then the status becomes “Awaiting Executive Director approval” and the task is visible only to the Executive Director and authorised management staff.
- **GR-04 — No non-Executive-Director approval.** Given an account without the explicit Executive Director grant-approval permission attempts to approve a grant, concept note, funding application or media funding record, when the request reaches the server, then it is rejected with HTTP 403, no status changes, and a security audit event is written.
- **GR-05 — External submission excluded.** Given a grant draft is marked Approved by the Executive Director, when any user requests donor dispatch, portal submission, external email or application submission from this system, then the operation is unavailable and no external request is sent.
- **GR-06 — Read-only crawler boundary.** Given a crawler fetches an opportunity source, when the crawl executes, then it performs read-only source retrieval and writes only crawler-owned discovery/evidence records; it cannot modify governance records, Drive documents, application records or unrelated collections.
- **GR-07 — AI analysis evidence.** Given an authorised analyst requests eligibility, geographic fit, IRPA strategic alignment or donor alignment, when the analyser completes, then it returns PASS/FAIL/UNKNOWN with cited source evidence, retrieval timestamp, confidence and explicit unknowns and never fabricates donor criteria.
- **GR-08 — Concept note advisor.** Given authorised staff provide verified opportunity and IRPA project facts, when the advisor drafts guidance, then it produces an editable internal draft with assumptions, missing information, risks and fit rationale and does not submit or send it externally.
- **GR-09 — Communication & Media funding.** Given a funding record is prepared in Communication & Media, when it is submitted for decision, then it follows the same Executive Director approval state machine and never enters a governance workflow.
- **GR-10 — Server-side Executive Director grant approval enforcement.** <strong>GAP — NOT VERIFIED IN IMPLEMENTATION.</strong> Given an authenticated user calls any grant/funding approval endpoint directly, when the server processes the decision, then it must independently verify the explicit Executive Director grant-approval entitlement, reject every other role with HTTP 403, persist no state change on rejection, and audit both accepted and denied decisions. UI role labels or hidden controls are not evidence of enforcement. The required server-side entitlement and endpoint enforcement are not confirmed by this documentation review and remain a release-blocking implementation gap.

### Cross-cutting requirements

- **ROLE-01 — Executive Director role.** Given an account is assigned the Executive Director role, when its authenticated session requests grant approval functions, then the server authorises only the explicit Executive Director approval permissions and audits every decision.
- **ROLE-02 — Separation of duties.** Given an account lacks the explicit Executive Director grant-approval permission, when it calls any grant approval endpoint directly, then the server denies the request and leaves the grant record unchanged.
- **OFF-01 — Installable/offline application.** Given a supported browser installs the application, when the user launches it without network connectivity, then the app shell and explicitly cache-approved static assets load, the UI marks cached data with its last-sync timestamp, and all server-authorised writes, approvals, signatures and permission changes remain disabled until connectivity and fresh authorisation are re-established.
- **OFF-02 — Offline security boundary.** Given a user is offline or a session is expired/revoked, when protected data or a write action is requested, then no stale credential, cached role or queued command can grant access or execute a privileged action; pending non-sensitive drafts remain visibly unsent and require revalidation before sync.
- **MOB-01 — Responsive mobile layout stack.** Given viewport width is 390 CSS pixels, when any portal is rendered, then the shell uses a single-column content stack, hides or collapses secondary navigation accessibly, wraps action controls, keeps cards and form controls within the viewport, and produces no horizontal page overflow.
- **MOB-02 — Desktop layout.** Given viewport width is 1440 CSS pixels, when a portal is rendered, then primary navigation and content use a two-column layout with bounded content width and no horizontal page overflow.
- **AI-05 — Explainability and human decision.** Given the Grant Intelligence AI produces a score, summary or recommendation, when the result is displayed, then each material conclusion is linked to evidence and confidence/unknowns and is labelled advisory; only the Executive Director can make the internal approval decision.
- **AI-06 — No autonomous external action.** Given an AI analysis or draft is complete, when a model attempts to send, submit, sign, approve, or contact a donor, then the action is blocked and no external side effect occurs.
- **DR-01 — Backup and recovery policy (proposed; not approved).** Given the backup service runs, when the daily scheduled backup completes, then a protected backup is created, retained for 30 days, and a restore test is recorded; policy status remains “TO BE APPROVED BY IRPA MANAGEMENT” until management approval is documented.

### Backup, retention and disaster recovery decision

**TO BE APPROVED BY IRPA MANAGEMENT.** Proposed default for management review: daily backup; 30-day retention; encrypted backup storage with restricted key custody; and a tested restore (at least monthly and after material infrastructure changes). RPO, RTO, legal hold, backup scope, encryption/key custody, off-site replication and disaster-recovery ownership remain open management decisions. These defaults are proposals, not approved policy.

### Traceability additions

| Requirement ID | Scope | Acceptance criteria | Wireframe / module | Verification |
|---|---|---|---|---|
| GR-01–GR-10 | Grant preparation, Executive Director approval, server-side enforcement GAP, non-submission and crawler boundary | GR-01–GR-10 | MOD-23, MOD-24; grant and communication wireframes | Proposed role/API integration tests; GR-10 implementation verification GAP |
| ROLE-01–ROLE-02 | Explicit ED approval role and separation of duties | ROLE-01–ROLE-02 | Role matrix; MOD-23/MOD-24 | Proposed positive and negative permission tests |
| OFF-01–OFF-02 | Installable/offline app and security boundary | OFF-01–OFF-02 | SHARED-03, SHARED-04 | Proposed install/offline/revocation tests |
| MOB-01–MOB-02 | Mobile/desktop layout stack | MOB-01–MOB-02 | All 72 wireframes | Browser viewport and overflow tests |
| AI-05–AI-06 | Explainable AI and no autonomous external action | AI-05–AI-06 | MOD-23 | Proposed AI safety and side-effect tests |
| DR-01 | Backup, retention and restore | DR-01 | MOD-01 / IT Operations | Proposed scheduled backup and restore drill |

### Module requirement coverage register

The 31 source-baseline modules retain their existing MOD-01 through MOD-31 requirement headers and two or more Given/When/Then criteria each; the standalone portals retain STD-01 through STD-03, the nested portals retain SUB-01 through SUB-15, and the 59 enumerated route/path families retain API-01 through API-59. Grant-specific additional requirements are GR-01 through GR-10 (GR-10 server-side enforcement GAP) and ROLE-01 through ROLE-02; shared offline/mobile requirements are OFF-01 through OFF-02 and MOB-01 through MOB-02; AI additions are AI-05 through AI-06; recovery is DR-01. Existing test IDs remain PROPOSED until executable tests are implemented and run.
