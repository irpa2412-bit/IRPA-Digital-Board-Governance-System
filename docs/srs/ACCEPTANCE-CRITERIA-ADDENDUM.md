# Detailed acceptance criteria and traceability addendum

**Applies to:** IRPA Digital Board Governance System SRS, baseline 31 modules. **Status:** Proposed test specification; test execution is not implied. The existing requirement identifiers are retained. The criteria below extend the current two-criterion entries with additional, observable outcomes. Every test identifier below is proposed until implemented and executed.

## Acceptance-test conventions

- A protected API must enforce authorization server-side; hiding a navigation item is not an access control.
- A successful write must return a stable record identifier and persist the specified audit fields.
- A rejected write must not partially mutate the record or related workflow state.
- Timestamps are stored in UTC and displayed in the user's configured timezone; monetary assertions compare numeric amounts and explicit currency codes.
- `PASS`, `FAIL`, `UNKNOWN` and `NOT RUN` are distinct states. Missing evidence must never be represented as PASS.

## 31 top-level modules

### MOD-01 — IT Operations
**Page:** `it-operations.html` · **Requirement:** `MOD-01` · **Tests:** `TEST-MOD-01-03..05` (PROPOSED)

- **MOD-01-AC3** — Given an authorized user opens this module and the fixture contains records with the fields configured service health, dependency, last-check time, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-01-03`.
- **MOD-01-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to diagnostic probe and role-scoped health view, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-01-04`.
- **MOD-01-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits probe failure recorded without exposing secrets, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-01-05`.

### MOD-02 — Dashboard
**Page:** `dashboard.html` · **Requirement:** `MOD-02` · **Tests:** `TEST-MOD-02-03..05` (PROPOSED)

- **MOD-02-AC3** — Given an authorized user opens this module and the fixture contains records with the fields role-scoped cards, source timestamp, environment label, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-02-03`.
- **MOD-02-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to card refresh and partial-source failure, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-02-04`.
- **MOD-02-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits failed card isolated; retry does not duplicate data, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-02-05`.

### MOD-03 — Induction and Orientation
**Page:** `induction-and-orientation.html` · **Requirement:** `MOD-03` · **Tests:** `TEST-MOD-03-03..05` (PROPOSED)

- **MOD-03-AC3** — Given an authorized user opens this module and the fixture contains records with the fields required induction steps, completion state, due date, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-03-03`.
- **MOD-03-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to completion submission after all required steps, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-03-04`.
- **MOD-03-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits missing step blocks completion and identifies step, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-03-05`.

### MOD-04 — Induction Applications
**Page:** `induction-applications.html` · **Requirement:** `MOD-04` · **Tests:** `TEST-MOD-04-03..05` (PROPOSED)

- **MOD-04-AC3** — Given an authorized user opens this module and the fixture contains records with the fields applicant identity, application status, reviewer history, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-04-03`.
- **MOD-04-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to reviewer approve or reject with reason, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-04-04`.
- **MOD-04-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits invalid transition or missing reason rejected, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-04-05`.

### MOD-05 — Board Members Registration
**Page:** `board-members-registration.html` · **Requirement:** `MOD-05` · **Tests:** `TEST-MOD-05-03..05` (PROPOSED)

- **MOD-05-AC3** — Given an authorized user opens this module and the fixture contains records with the fields member identity, appointment dates, term, status, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-05-03`.
- **MOD-05-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to create/update registration with unique identity, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-05-04`.
- **MOD-05-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits duplicate identity or invalid appointment dates rejected, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-05-05`.

### MOD-06 — Members & Personnel
**Page:** `members-and-personnel.html` · **Requirement:** `MOD-06` · **Tests:** `TEST-MOD-06-03..05` (PROPOSED)

- **MOD-06-AC3** — Given an authorized user opens this module and the fixture contains records with the fields personnel ID, department, role, active status, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-06-03`.
- **MOD-06-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to authorized HR update to personnel record, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-06-04`.
- **MOD-06-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits unauthorized scope or invalid field rejected; audit diff retained, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-06-05`.

### MOD-07 — Invitations
**Page:** `invitations.html` · **Requirement:** `MOD-07` · **Tests:** `TEST-MOD-07-03..05` (PROPOSED)

- **MOD-07-AC3** — Given an authorized user opens this module and the fixture contains records with the fields recipient, purpose, role scope, expiry, redemption status, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-07-03`.
- **MOD-07-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to issue, revoke or redeem invitation token, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-07-04`.
- **MOD-07-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits expired/revoked/redeemed/mismatched token denied, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-07-05`.

### MOD-08 — Meetings
**Page:** `meetings.html` · **Requirement:** `MOD-08` · **Tests:** `TEST-MOD-08-03..05` (PROPOSED)

- **MOD-08-AC3** — Given an authorized user opens this module and the fixture contains records with the fields meeting ID, date/time, agenda, quorum, participants, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-08-03`.
- **MOD-08-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to create meeting and publish agenda, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-08-04`.
- **MOD-08-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits missing mandatory field or invalid date rejected, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-08-05`.

### MOD-09 — Resolutions
**Page:** `resolutions.html` · **Requirement:** `MOD-09` · **Tests:** `TEST-MOD-09-03..05` (PROPOSED)

- **MOD-09-AC3** — Given an authorized user opens this module and the fixture contains records with the fields resolution ID, source meeting, wording, owner, status, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-09-03`.
- **MOD-09-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to record resolution and change implementation status, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-09-04`.
- **MOD-09-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits invalid status transition rejected; prior state retained, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-09-05`.

### MOD-10 — Voting
**Page:** `voting.html` · **Requirement:** `MOD-10` · **Tests:** `TEST-MOD-10-03..05` (PROPOSED)

- **MOD-10-AC3** — Given an authorized user opens this module and the fixture contains records with the fields ballot ID, eligible voter set, open/close times, tally, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-10-03`.
- **MOD-10-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to cast one ballot per eligible voter, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-10-04`.
- **MOD-10-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits duplicate/ineligible/late ballot rejected; tally unchanged, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-10-05`.

### MOD-11 — Actions
**Page:** `actions.html` · **Requirement:** `MOD-11` · **Tests:** `TEST-MOD-11-03..05` (PROPOSED)

- **MOD-11-AC3** — Given an authorized user opens this module and the fixture contains records with the fields action ID, source decision, owner, due date, progress, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-11-03`.
- **MOD-11-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to assign action and submit progress update, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-11-04`.
- **MOD-11-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits missing owner/due date or invalid transition rejected, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-11-05`.

### MOD-12 — Documents
**Page:** `documents.html` · **Requirement:** `MOD-12` · **Tests:** `TEST-MOD-12-03..05` (PROPOSED)

- **MOD-12-AC3** — Given an authorized user opens this module and the fixture contains records with the fields document ID, owner, department, classification, version, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-12-03`.
- **MOD-12-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to upload, share or retrieve document, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-12-04`.
- **MOD-12-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits unauthorized classification/share/download blocked, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-12-05`.

### MOD-13 — Signature Platform
**Page:** `signature-platform.html` · **Requirement:** `MOD-13` · **Tests:** `TEST-MOD-13-03..05` (PROPOSED)

- **MOD-13-AC3** — Given an authorized user opens this module and the fixture contains records with the fields envelope ID, assigned signer, document hash, field status, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-13-03`.
- **MOD-13-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to complete signature with evidence and timestamp, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-13-04`.
- **MOD-13-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits wrong signer, altered hash or incomplete fields cannot complete, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-13-05`.

### MOD-14 — Decisions
**Page:** `decisions.html` · **Requirement:** `MOD-14` · **Tests:** `TEST-MOD-14-03..05` (PROPOSED)

- **MOD-14-AC3** — Given an authorized user opens this module and the fixture contains records with the fields decision ID, meeting reference, decision text, owner, due date, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-14-03`.
- **MOD-14-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to record decision and link implementation action, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-14-04`.
- **MOD-14-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits orphaned meeting reference or invalid status rejected, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-14-05`.

### MOD-15 — Risk Register
**Page:** `risk-register.html` · **Requirement:** `MOD-15` · **Tests:** `TEST-MOD-15-03..05` (PROPOSED)

- **MOD-15-AC3** — Given an authorized user opens this module and the fixture contains records with the fields risk ID, likelihood, impact, owner, mitigation, review date, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-15-03`.
- **MOD-15-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to create and reassess risk using approved rating matrix, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-15-04`.
- **MOD-15-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits missing rating inputs rejected; previous assessment preserved, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-15-05`.

### MOD-16 — Authorization & Approvals
**Page:** `authorization-and-approvals.html` · **Requirement:** `MOD-16` · **Tests:** `TEST-MOD-16-03..05` (PROPOSED)

- **MOD-16-AC3** — Given an authorized user opens this module and the fixture contains records with the fields request type, amount/scope, approver, decision, reason, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-16-03`.
- **MOD-16-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to submit request and route to authorized approver, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-16-04`.
- **MOD-16-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits self-approval or out-of-delegation approval denied, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-16-05`.

### MOD-17 — Employee Payments
**Page:** `employee-payments.html` · **Requirement:** `MOD-17` · **Tests:** `TEST-MOD-17-03..05` (PROPOSED)

- **MOD-17-AC3** — Given an authorized user opens this module and the fixture contains records with the fields employee, pay period, gross/net amount, deductions, approval, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-17-03`.
- **MOD-17-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to validate and submit payment batch, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-17-04`.
- **MOD-17-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits unapproved, duplicate or unbalanced batch cannot proceed, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-17-05`.

### MOD-18 — Research, Statistics and Knowledge
**Page:** `research-statistics-and-knowledge.html` · **Requirement:** `MOD-18` · **Tests:** `TEST-MOD-18-03..05` (PROPOSED)

- **MOD-18-AC3** — Given an authorized user opens this module and the fixture contains records with the fields dataset/output ID, steward, version, classification, approval, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-18-03`.
- **MOD-18-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to register, analyse or publish research output, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-18-04`.
- **MOD-18-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits unapproved or restricted output cannot be published, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-18-05`.

### MOD-19 — Finance Portfolio
**Page:** `finance-portfolio.html` · **Requirement:** `MOD-19` · **Tests:** `TEST-MOD-19-03..05` (PROPOSED)

- **MOD-19-AC3** — Given an authorized user opens this module and the fixture contains records with the fields fund, donor, budget line, currency, actual/trial, period, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-19-03`.
- **MOD-19-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to filter finance portfolio and reconcile totals, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-19-04`.
- **MOD-19-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits environment mismatch or unauthorized finance access denied, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-19-05`.

### MOD-20 — Procurement
**Page:** `procurement.html` · **Requirement:** `MOD-20` · **Tests:** `TEST-MOD-20-03..05` (PROPOSED)

- **MOD-20-AC3** — Given an authorized user opens this module and the fixture contains records with the fields request ID, specification, budget code, quotes, approval, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-20-03`.
- **MOD-20-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to submit procurement request and record award decision, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-20-04`.
- **MOD-20-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits missing procurement evidence or invalid approval state rejected, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-20-05`.

### MOD-21 — Reports
**Page:** `reports.html` · **Requirement:** `MOD-21` · **Tests:** `TEST-MOD-21-03..05` (PROPOSED)

- **MOD-21-AC3** — Given an authorized user opens this module and the fixture contains records with the fields report ID, filters, generated-at, classification, record count, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-21-03`.
- **MOD-21-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to generate and export scoped report, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-21-04`.
- **MOD-21-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits out-of-scope records excluded; failed export reports error, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-21-05`.

### MOD-22 — Audit Trail
**Page:** `audit-trail.html` · **Requirement:** `MOD-22` · **Tests:** `TEST-MOD-22-03..05` (PROPOSED)

- **MOD-22-AC3** — Given an authorized user opens this module and the fixture contains records with the fields event ID, actor, action, target, timestamp, outcome, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-22-03`.
- **MOD-22-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to search audit events and export authorized result, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-22-04`.
- **MOD-22-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits unauthorized query returns 403 and no event payload, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-22-05`.

### MOD-23 — Grant Intelligence & Funding Opportunities
**Page:** `grant-intelligence-and-funding-opportunities.html` · **Requirement:** `MOD-23` · **Tests:** `TEST-MOD-23-03..05` (PROPOSED)

- **MOD-23-AC3** — Given an authorized user opens this module and the fixture contains records with the fields opportunity source, captured-at, verification state, eligibility evidence, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-23-03`.
- **MOD-23-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to run eligibility and donor-alignment analysis, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-23-04`.
- **MOD-23-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits unknown evidence stays UNKNOWN; no donor contact/submission, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-23-05`.

### MOD-24 — Communication & Media
**Page:** `communication-and-media.html` · **Requirement:** `MOD-24` · **Tests:** `TEST-MOD-24-03..05` (PROPOSED)

- **MOD-24-AC3** — Given an authorized user opens this module and the fixture contains records with the fields channel, content version, approval, destination, provider result, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-24-03`.
- **MOD-24-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to submit approved content for publication, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-24-04`.
- **MOD-24-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits unapproved draft is not dispatched; provider failure is audited, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-24-05`.

### MOD-25 — Downloads
**Page:** `downloads.html` · **Requirement:** `MOD-25` · **Tests:** `TEST-MOD-25-03..05` (PROPOSED)

- **MOD-25-AC3** — Given an authorized user opens this module and the fixture contains records with the fields resource ID, version, classification, owner, download permission, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-25-03`.
- **MOD-25-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to request protected download, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-25-04`.
- **MOD-25-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits unauthorized request returns no bytes and records denial, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-25-05`.

### MOD-26 — Settings
**Page:** `settings.html` · **Requirement:** `MOD-26` · **Tests:** `TEST-MOD-26-03..05` (PROPOSED)

- **MOD-26-AC3** — Given an authorized user opens this module and the fixture contains records with the fields setting key, value, scope, editor role, effective date, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-26-03`.
- **MOD-26-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to save authorized configuration change, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-26-04`.
- **MOD-26-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits invalid value or unauthorized change rejected and audited, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-26-05`.

### MOD-27 — Add Administrator
**Page:** `add-administrator.html` · **Requirement:** `MOD-27` · **Tests:** `TEST-MOD-27-03..05` (PROPOSED)

- **MOD-27-AC3** — Given an authorized user opens this module and the fixture contains records with the fields administrator identity, approval, least-privilege role, invite expiry, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-27-03`.
- **MOD-27-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to provision administrator through invitation, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-27-04`.
- **MOD-27-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits non-admin or unapproved provisioning creates no account, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-27-05`.

### MOD-28 — Department and Archive Registry
**Page:** `department-and-archive-registry.html` · **Requirement:** `MOD-28` · **Tests:** `TEST-MOD-28-03..05` (PROPOSED)

- **MOD-28-AC3** — Given an authorized user opens this module and the fixture contains records with the fields department/archive ID, owner, classification, lifecycle, retention class, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-28-03`.
- **MOD-28-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to register archive item and retrieve by scoped search, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-28-04`.
- **MOD-28-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits duplicate ID or unauthorized retrieval rejected, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-28-05`.

### MOD-29 — Department Portal Builder
**Page:** `department-portal-builder.html` · **Requirement:** `MOD-29` · **Tests:** `TEST-MOD-29-03..05` (PROPOSED)

- **MOD-29-AC3** — Given an authorized user opens this module and the fixture contains records with the fields portal key, parent, label, module permissions, publication state, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-29-03`.
- **MOD-29-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to save and activate portal definition, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-29-04`.
- **MOD-29-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits duplicate key, invalid parent or privilege escalation rejected, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-29-05`.

### MOD-30 — External Auditor Portal
**Page:** `external-auditor-portal.html` · **Requirement:** `MOD-30` · **Tests:** `TEST-MOD-30-03..05` (PROPOSED)

- **MOD-30-AC3** — Given an authorized user opens this module and the fixture contains records with the fields auditor identity, assignment, evidence scope, access window, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-30-03`.
- **MOD-30-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to activate auditor access and retrieve assigned evidence, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-30-04`.
- **MOD-30-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits expired/revoked scope denied on every protected request, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-30-05`.

### MOD-31 — Auditors & Special Invitees
**Page:** `auditors-and-special-invitees.html` · **Requirement:** `MOD-31` · **Tests:** `TEST-MOD-31-03..05` (PROPOSED)

- **MOD-31-AC3** — Given an authorized user opens this module and the fixture contains records with the fields invitee identity, purpose, sponsor, scope, expiry, when the user loads the module list and applies a supported filter, then each returned row displays the listed fields, the result count equals the returned rows, and no record outside the user's assigned scope is returned. **Test:** `TEST-MOD-31-03`.
- **MOD-31-AC4** — Given the user has the module's create/update permission and supplies valid data, when the user performs the operation to issue, amend or revoke special invite, then the server persists one record, returns its stable ID, displays the saved state after reload, and writes an audit event with actor UID, action, target ID and UTC timestamp. **Test:** `TEST-MOD-31-04`.
- **MOD-31-AC5** — Given the request violates a required field, workflow state, uniqueness rule or permission as applicable, when the user submits expired, revoked or out-of-scope invite denied and logged, then the server returns a controlled validation/authorization error, no record or linked state is changed, and the response identifies the failed field or denied permission without exposing protected data. **Test:** `TEST-MOD-31-05`.


## Module-level requirement count

| Module | Requirement IDs | Acceptance criteria after addendum |
|---|---:|---:|
| IT Operations (MOD-01) | 1 | 5 |
| Dashboard (MOD-02) | 1 | 5 |
| Induction and Orientation (MOD-03) | 1 | 5 |
| Induction Applications (MOD-04) | 1 | 5 |
| Board Members Registration (MOD-05) | 1 | 5 |
| Members & Personnel (MOD-06) | 1 | 5 |
| Invitations (MOD-07) | 1 | 5 |
| Meetings (MOD-08) | 1 | 5 |
| Resolutions (MOD-09) | 1 | 5 |
| Voting (MOD-10) | 1 | 5 |
| Actions (MOD-11) | 1 | 5 |
| Documents (MOD-12) | 1 | 5 |
| Signature Platform (MOD-13) | 1 | 5 |
| Decisions (MOD-14) | 1 | 5 |
| Risk Register (MOD-15) | 1 | 5 |
| Authorization & Approvals (MOD-16) | 1 | 5 |
| Employee Payments (MOD-17) | 1 | 5 |
| Research, Statistics and Knowledge (MOD-18) | 1 | 5 |
| Finance Portfolio (MOD-19) | 1 | 5 |
| Procurement (MOD-20) | 1 | 5 |
| Reports (MOD-21) | 1 | 5 |
| Audit Trail (MOD-22) | 1 | 5 |
| Grant Intelligence & Funding Opportunities (MOD-23) | 1 | 5 |
| Communication & Media (MOD-24) | 1 | 5 |
| Downloads (MOD-25) | 1 | 5 |
| Settings (MOD-26) | 1 | 5 |
| Add Administrator (MOD-27) | 1 | 5 |
| Department and Archive Registry (MOD-28) | 1 | 5 |
| Department Portal Builder (MOD-29) | 1 | 5 |
| External Auditor Portal (MOD-30) | 1 | 5 |
| Auditors & Special Invitees (MOD-31) | 1 | 5 |

## 15 registered nested sub-portals

### SUB-01 — Meeting Room
**Parent:** Meetings · **Page:** `meetings-meeting-room.html` · **Requirement:** `SUB-01` · **Tests:** `TEST-SUB-01-03..05` (PROPOSED)

- **SUB-01-AC3** — Given a user has parent and child read permission and fixtures contain meeting detail, agenda, attachments and minutes, when the child portal is opened, then only records in the parent context and assigned scope appear with the listed fields and a visible empty state appears when the scoped result is zero. **Test:** `TEST-SUB-01-03`.
- **SUB-01-AC4** — Given the user has the child-specific action permission, when the user attempts to open meeting room for an assigned meeting, then the child action validates its parent record reference, persists the result once, and records actor, target, outcome and timestamp in the audit history. **Test:** `TEST-SUB-01-04`.
- **SUB-01-AC5** — Given parent permission, child permission, record scope or lifecycle state is absent/invalid, when the child URL or protected action is requested directly, then the server returns 403/404 or a documented validation response, returns no protected content, and performs no mutation. **Test:** `TEST-SUB-01-05`.

### SUB-02 — Participants
**Parent:** Meetings · **Page:** `meetings-participants.html` · **Requirement:** `SUB-02` · **Tests:** `TEST-SUB-02-03..05` (PROPOSED)

- **SUB-02-AC3** — Given a user has parent and child read permission and fixtures contain participant identity, attendance, apologies and role, when the child portal is opened, then only records in the parent context and assigned scope appear with the listed fields and a visible empty state appears when the scoped result is zero. **Test:** `TEST-SUB-02-03`.
- **SUB-02-AC4** — Given the user has the child-specific action permission, when the user attempts to record attendance for a meeting, then the child action validates its parent record reference, persists the result once, and records actor, target, outcome and timestamp in the audit history. **Test:** `TEST-SUB-02-04`.
- **SUB-02-AC5** — Given parent permission, child permission, record scope or lifecycle state is absent/invalid, when the child URL or protected action is requested directly, then the server returns 403/404 or a documented validation response, returns no protected content, and performs no mutation. **Test:** `TEST-SUB-02-05`.

### SUB-03 — Resolutions
**Parent:** Meetings · **Page:** `meetings-resolutions.html` · **Requirement:** `SUB-03` · **Tests:** `TEST-SUB-03-03..05` (PROPOSED)

- **SUB-03-AC3** — Given a user has parent and child read permission and fixtures contain resolution wording, mover/seconder, vote reference and status, when the child portal is opened, then only records in the parent context and assigned scope appear with the listed fields and a visible empty state appears when the scoped result is zero. **Test:** `TEST-SUB-03-03`.
- **SUB-03-AC4** — Given the user has the child-specific action permission, when the user attempts to record and link meeting resolution, then the child action validates its parent record reference, persists the result once, and records actor, target, outcome and timestamp in the audit history. **Test:** `TEST-SUB-03-04`.
- **SUB-03-AC5** — Given parent permission, child permission, record scope or lifecycle state is absent/invalid, when the child URL or protected action is requested directly, then the server returns 403/404 or a documented validation response, returns no protected content, and performs no mutation. **Test:** `TEST-SUB-03-05`.

### SUB-04 — Voting
**Parent:** Meetings · **Page:** `meetings-voting.html` · **Requirement:** `SUB-04` · **Tests:** `TEST-SUB-04-03..05` (PROPOSED)

- **SUB-04-AC3** — Given a user has parent and child read permission and fixtures contain ballot options, eligibility, opening/closing state and tally, when the child portal is opened, then only records in the parent context and assigned scope appear with the listed fields and a visible empty state appears when the scoped result is zero. **Test:** `TEST-SUB-04-03`.
- **SUB-04-AC4** — Given the user has the child-specific action permission, when the user attempts to open ballot and cast vote, then the child action validates its parent record reference, persists the result once, and records actor, target, outcome and timestamp in the audit history. **Test:** `TEST-SUB-04-04`.
- **SUB-04-AC5** — Given parent permission, child permission, record scope or lifecycle state is absent/invalid, when the child URL or protected action is requested directly, then the server returns 403/404 or a documented validation response, returns no protected content, and performs no mutation. **Test:** `TEST-SUB-04-05`.

### SUB-05 — Actions
**Parent:** Meetings · **Page:** `meetings-actions.html` · **Requirement:** `SUB-05` · **Tests:** `TEST-SUB-05-03..05` (PROPOSED)

- **SUB-05-AC3** — Given a user has parent and child read permission and fixtures contain action owner, due date, progress, source minute, when the child portal is opened, then only records in the parent context and assigned scope appear with the listed fields and a visible empty state appears when the scoped result is zero. **Test:** `TEST-SUB-05-03`.
- **SUB-05-AC4** — Given the user has the child-specific action permission, when the user attempts to assign and update meeting action, then the child action validates its parent record reference, persists the result once, and records actor, target, outcome and timestamp in the audit history. **Test:** `TEST-SUB-05-04`.
- **SUB-05-AC5** — Given parent permission, child permission, record scope or lifecycle state is absent/invalid, when the child URL or protected action is requested directly, then the server returns 403/404 or a documented validation response, returns no protected content, and performs no mutation. **Test:** `TEST-SUB-05-05`.

### SUB-06 — Decisions
**Parent:** Meetings · **Page:** `meetings-decisions.html` · **Requirement:** `SUB-06` · **Tests:** `TEST-SUB-06-03..05` (PROPOSED)

- **SUB-06-AC3** — Given a user has parent and child read permission and fixtures contain decision text, authority, meeting reference and implementation owner, when the child portal is opened, then only records in the parent context and assigned scope appear with the listed fields and a visible empty state appears when the scoped result is zero. **Test:** `TEST-SUB-06-03`.
- **SUB-06-AC4** — Given the user has the child-specific action permission, when the user attempts to record decision from meeting, then the child action validates its parent record reference, persists the result once, and records actor, target, outcome and timestamp in the audit history. **Test:** `TEST-SUB-06-04`.
- **SUB-06-AC5** — Given parent permission, child permission, record scope or lifecycle state is absent/invalid, when the child URL or protected action is requested directly, then the server returns 403/404 or a documented validation response, returns no protected content, and performs no mutation. **Test:** `TEST-SUB-06-05`.

### SUB-07 — My Documents
**Parent:** Documents · **Page:** `documents-my-documents.html` · **Requirement:** `SUB-07` · **Tests:** `TEST-SUB-07-03..05` (PROPOSED)

- **SUB-07-AC3** — Given a user has parent and child read permission and fixtures contain current user's owned documents, versions and classification, when the child portal is opened, then only records in the parent context and assigned scope appear with the listed fields and a visible empty state appears when the scoped result is zero. **Test:** `TEST-SUB-07-03`.
- **SUB-07-AC4** — Given the user has the child-specific action permission, when the user attempts to list and open own documents, then the child action validates its parent record reference, persists the result once, and records actor, target, outcome and timestamp in the audit history. **Test:** `TEST-SUB-07-04`.
- **SUB-07-AC5** — Given parent permission, child permission, record scope or lifecycle state is absent/invalid, when the child URL or protected action is requested directly, then the server returns 403/404 or a documented validation response, returns no protected content, and performs no mutation. **Test:** `TEST-SUB-07-05`.

### SUB-08 — Department Documents
**Parent:** Documents · **Page:** `documents-department-documents.html` · **Requirement:** `SUB-08` · **Tests:** `TEST-SUB-08-03..05` (PROPOSED)

- **SUB-08-AC3** — Given a user has parent and child read permission and fixtures contain department scope, document owner, classification and version, when the child portal is opened, then only records in the parent context and assigned scope appear with the listed fields and a visible empty state appears when the scoped result is zero. **Test:** `TEST-SUB-08-03`.
- **SUB-08-AC4** — Given the user has the child-specific action permission, when the user attempts to filter department document register, then the child action validates its parent record reference, persists the result once, and records actor, target, outcome and timestamp in the audit history. **Test:** `TEST-SUB-08-04`.
- **SUB-08-AC5** — Given parent permission, child permission, record scope or lifecycle state is absent/invalid, when the child URL or protected action is requested directly, then the server returns 403/404 or a documented validation response, returns no protected content, and performs no mutation. **Test:** `TEST-SUB-08-05`.

### SUB-09 — Shared With Me
**Parent:** Documents · **Page:** `documents-shared-with-me.html` · **Requirement:** `SUB-09` · **Tests:** `TEST-SUB-09-03..05` (PROPOSED)

- **SUB-09-AC3** — Given a user has parent and child read permission and fixtures contain sharer, recipient, permission, expiry and document version, when the child portal is opened, then only records in the parent context and assigned scope appear with the listed fields and a visible empty state appears when the scoped result is zero. **Test:** `TEST-SUB-09-03`.
- **SUB-09-AC4** — Given the user has the child-specific action permission, when the user attempts to open shared item before permission expiry, then the child action validates its parent record reference, persists the result once, and records actor, target, outcome and timestamp in the audit history. **Test:** `TEST-SUB-09-04`.
- **SUB-09-AC5** — Given parent permission, child permission, record scope or lifecycle state is absent/invalid, when the child URL or protected action is requested directly, then the server returns 403/404 or a documented validation response, returns no protected content, and performs no mutation. **Test:** `TEST-SUB-09-05`.

### SUB-10 — Signing Workspace
**Parent:** Documents · **Page:** `documents-signing-workspace.html` · **Requirement:** `SUB-10` · **Tests:** `TEST-SUB-10-03..05` (PROPOSED)

- **SUB-10-AC3** — Given a user has parent and child read permission and fixtures contain assigned envelope, signer, required fields and deadline, when the child portal is opened, then only records in the parent context and assigned scope appear with the listed fields and a visible empty state appears when the scoped result is zero. **Test:** `TEST-SUB-10-03`.
- **SUB-10-AC4** — Given the user has the child-specific action permission, when the user attempts to open assigned signing task, then the child action validates its parent record reference, persists the result once, and records actor, target, outcome and timestamp in the audit history. **Test:** `TEST-SUB-10-04`.
- **SUB-10-AC5** — Given parent permission, child permission, record scope or lifecycle state is absent/invalid, when the child URL or protected action is requested directly, then the server returns 403/404 or a documented validation response, returns no protected content, and performs no mutation. **Test:** `TEST-SUB-10-05`.

### SUB-11 — Post-Signature Work
**Parent:** Documents · **Page:** `documents-post-signature-work.html` · **Requirement:** `SUB-11` · **Tests:** `TEST-SUB-11-03..05` (PROPOSED)

- **SUB-11-AC3** — Given a user has parent and child read permission and fixtures contain completed envelope, evidence package and archive status, when the child portal is opened, then only records in the parent context and assigned scope appear with the listed fields and a visible empty state appears when the scoped result is zero. **Test:** `TEST-SUB-11-03`.
- **SUB-11-AC4** — Given the user has the child-specific action permission, when the user attempts to complete post-signature verification, then the child action validates its parent record reference, persists the result once, and records actor, target, outcome and timestamp in the audit history. **Test:** `TEST-SUB-11-04`.
- **SUB-11-AC5** — Given parent permission, child permission, record scope or lifecycle state is absent/invalid, when the child URL or protected action is requested directly, then the server returns 403/404 or a documented validation response, returns no protected content, and performs no mutation. **Test:** `TEST-SUB-11-05`.

### SUB-12 — Final Archive
**Parent:** Documents · **Page:** `documents-final-archive.html` · **Requirement:** `SUB-12` · **Tests:** `TEST-SUB-12-03..05` (PROPOSED)

- **SUB-12-AC3** — Given a user has parent and child read permission and fixtures contain final version, signature evidence, classification and archive reference, when the child portal is opened, then only records in the parent context and assigned scope appear with the listed fields and a visible empty state appears when the scoped result is zero. **Test:** `TEST-SUB-12-03`.
- **SUB-12-AC4** — Given the user has the child-specific action permission, when the user attempts to archive completed controlled document, then the child action validates its parent record reference, persists the result once, and records actor, target, outcome and timestamp in the audit history. **Test:** `TEST-SUB-12-04`.
- **SUB-12-AC5** — Given parent permission, child permission, record scope or lifecycle state is absent/invalid, when the child URL or protected action is requested directly, then the server returns 403/404 or a documented validation response, returns no protected content, and performs no mutation. **Test:** `TEST-SUB-12-05`.

### SUB-13 — Upload Document
**Parent:** Documents · **Page:** `documents-upload-document.html` · **Requirement:** `SUB-13` · **Tests:** `TEST-SUB-13-03..05` (PROPOSED)

- **SUB-13-AC3** — Given a user has parent and child read permission and fixtures contain file type/size, metadata, classification and checksum, when the child portal is opened, then only records in the parent context and assigned scope appear with the listed fields and a visible empty state appears when the scoped result is zero. **Test:** `TEST-SUB-13-03`.
- **SUB-13-AC4** — Given the user has the child-specific action permission, when the user attempts to upload and register document, then the child action validates its parent record reference, persists the result once, and records actor, target, outcome and timestamp in the audit history. **Test:** `TEST-SUB-13-04`.
- **SUB-13-AC5** — Given parent permission, child permission, record scope or lifecycle state is absent/invalid, when the child URL or protected action is requested directly, then the server returns 403/404 or a documented validation response, returns no protected content, and performs no mutation. **Test:** `TEST-SUB-13-05`.

### SUB-14 — Retrieve Archived Documents
**Parent:** Documents · **Page:** `documents-retrieve-archived-documents.html` · **Requirement:** `SUB-14` · **Tests:** `TEST-SUB-14-03..05` (PROPOSED)

- **SUB-14-AC3** — Given a user has parent and child read permission and fixtures contain archive reference, requester purpose, authorization and retrieval event, when the child portal is opened, then only records in the parent context and assigned scope appear with the listed fields and a visible empty state appears when the scoped result is zero. **Test:** `TEST-SUB-14-03`.
- **SUB-14-AC4** — Given the user has the child-specific action permission, when the user attempts to request archived document retrieval, then the child action validates its parent record reference, persists the result once, and records actor, target, outcome and timestamp in the audit history. **Test:** `TEST-SUB-14-04`.
- **SUB-14-AC5** — Given parent permission, child permission, record scope or lifecycle state is absent/invalid, when the child URL or protected action is requested directly, then the server returns 403/404 or a documented validation response, returns no protected content, and performs no mutation. **Test:** `TEST-SUB-14-05`.

### SUB-15 — Induction Applications
**Parent:** Induction and Orientation · **Page:** `induction-and-orientation-induction-applications.html` · **Requirement:** `SUB-15` · **Tests:** `TEST-SUB-15-03..05` (PROPOSED)

- **SUB-15-AC3** — Given a user has parent and child read permission and fixtures contain application ID, applicant, checklist, reviewer and status, when the child portal is opened, then only records in the parent context and assigned scope appear with the listed fields and a visible empty state appears when the scoped result is zero. **Test:** `TEST-SUB-15-03`.
- **SUB-15-AC4** — Given the user has the child-specific action permission, when the user attempts to review application within induction parent portal, then the child action validates its parent record reference, persists the result once, and records actor, target, outcome and timestamp in the audit history. **Test:** `TEST-SUB-15-04`.
- **SUB-15-AC5** — Given parent permission, child permission, record scope or lifecycle state is absent/invalid, when the child URL or protected action is requested directly, then the server returns 403/404 or a documented validation response, returns no protected content, and performs no mutation. **Test:** `TEST-SUB-15-05`.

## Three standalone portals

### STD-01 — Dataset Registry
**Navigation:** standalone portal; top-level navigation and accountable owner remain subject to approval. **Page:** `dataset-registry.html` · **Requirement:** `STD-01` · **Tests:** `TEST-STD-01-03..06` (PROPOSED)

- **STD-01-AC3** — Given an authorized steward/collector/release manager supplies title, steward, source, schema version, classification, legal basis and access policy, when the user submits a complete valid record, then the portal persists a stable identifier and schema/version metadata and displays the saved state after reload. **Test:** `TEST-STD-01-03`.
- **STD-01-AC4** — Given a user searches or opens an existing record, when the user submits a filter or selects a result, then only permitted metadata and content for that user's scope are returned, with owner, version and lifecycle state visible. **Test:** `TEST-STD-01-04`.
- **STD-01-AC5** — Given restricted source payload is not copied into registry, when the user submits the invalid request, then submission is blocked with field-level errors and no partial record, release approval or publication is created. **Test:** `TEST-STD-01-05`.
- **STD-01-AC6** — Given search and export permitted metadata only, when the user retries the operation or requests its audit history, then the operation is idempotent or returns an explicit conflict, and the audit history shows the original and subsequent outcomes without silent overwrite. **Test:** `TEST-STD-01-06`.

### STD-02 — Research Data Collection
**Navigation:** standalone portal; top-level navigation and accountable owner remain subject to approval. **Page:** `research-data-collection.html` · **Requirement:** `STD-02` · **Tests:** `TEST-STD-02-03..06` (PROPOSED)

- **STD-02-AC3** — Given an authorized steward/collector/release manager supplies instrument version, required fields, validation rules and consent reference, when the user submits a complete valid record, then the portal persists a stable identifier and schema/version metadata and displays the saved state after reload. **Test:** `TEST-STD-02-03`.
- **STD-02-AC4** — Given a user searches or opens an existing record, when the user submits a filter or selects a result, then only permitted metadata and content for that user's scope are returned, with owner, version and lifecycle state visible. **Test:** `TEST-STD-02-04`.
- **STD-02-AC5** — Given invalid values/consent block submission, when the user submits the invalid request, then submission is blocked with field-level errors and no partial record, release approval or publication is created. **Test:** `TEST-STD-02-05`.
- **STD-02-AC6** — Given retry uses idempotency key and reports conflict without overwrite, when the user retries the operation or requests its audit history, then the operation is idempotent or returns an explicit conflict, and the audit history shows the original and subsequent outcomes without silent overwrite. **Test:** `TEST-STD-02-06`.

### STD-03 — Release Readiness
**Navigation:** standalone portal; top-level navigation and accountable owner remain subject to approval. **Page:** `release-readiness.html` · **Requirement:** `STD-03` · **Tests:** `TEST-STD-03-03..06` (PROPOSED)

- **STD-03-AC3** — Given an authorized steward/collector/release manager supplies build ID, CI/test evidence, security status, migration/rollback and approver, when the user submits a complete valid record, then the portal persists a stable identifier and schema/version metadata and displays the saved state after reload. **Test:** `TEST-STD-03-03`.
- **STD-03-AC4** — Given a user searches or opens an existing record, when the user submits a filter or selects a result, then only permitted metadata and content for that user's scope are returned, with owner, version and lifecycle state visible. **Test:** `TEST-STD-03-04`.
- **STD-03-AC5** — Given any mandatory FAIL/NOT RUN blocks approval, when the user submits the invalid request, then submission is blocked with field-level errors and no partial record, release approval or publication is created. **Test:** `TEST-STD-03-05`.
- **STD-03-AC6** — Given decision records approver, evidence links and timestamp, when the user retries the operation or requests its audit history, then the operation is idempotent or returns an explicit conflict, and the audit history shows the original and subsequent outcomes without silent overwrite. **Test:** `TEST-STD-03-06`.

## Grant Intelligence AI acceptance criteria

The four existing AI requirement IDs remain discovery and analysis only. These criteria make the boundary explicit; they do not authorize donor contact, donor portal login, submission, or dispatch.

### AI-01 — Crawler isolation
- **AI-01-AC3:** Given a crawler job is configured for an approved source allowlist, when the job executes, then every fetched URL, response status, fetch timestamp, parser version and resulting opportunity record is logged with provenance, and writes are restricted to the grant-crawler Worker's declared grant datasets. **Test:** `TEST-AI-01-03`.
- **AI-01-AC4:** Given the crawler is denied access to a Drive Gateway endpoint or unrelated collection, when a test attempts that access, then the attempt is rejected, no unrelated object is read or written, and the isolation event is recorded. **Test:** `TEST-AI-01-04`.
### AI-02 — Eligibility
- **AI-02-AC3:** Given an opportunity has an official call document and a configured eligibility checklist, when an analyst runs eligibility, then each criterion returns PASS, FAIL or UNKNOWN with source URL, quoted evidence locator/page, captured timestamp and rationale. **Test:** `TEST-AI-02-03`.
- **AI-02-AC4:** Given any mandatory criterion is FAIL or UNKNOWN, when the result is saved, then overall status is NOT ELIGIBLE or UNVERIFIED respectively and the UI never labels the opportunity eligible. **Test:** `TEST-AI-02-04`.
### AI-03 — Donor alignment
- **AI-03-AC3:** Given approved IRPA strategy/objectives and donor objectives have versioned sources, when alignment is run, then every mapped objective includes both source references, match rationale, mismatch, confidence and an explicit unknown where evidence is absent. **Test:** `TEST-AI-03-03`.
- **AI-03-AC4:** Given either source profile is missing or out of date, when alignment is requested, then the result is marked INCOMPLETE and no numeric donor-fit score is emitted. **Test:** `TEST-AI-03-04`.
### AI-04 — Concept note advisor (analysis only)
- **AI-04-AC3:** Given an analyst selects a verified opportunity and an approved project fact set, when the advisor drafts a concept note, then each material claim is linked to its source or marked ASSUMPTION/TO CONFIRM, and the draft includes problem, objective, target group, activities, outputs, outcomes, risks and missing information. **Test:** `TEST-AI-04-03`.
- **AI-04-AC4:** Given a draft is generated or revised, when the analyst saves or exports it, then version, author, source opportunity and generation timestamp are retained and the system exposes no send, submit, portal-login or donor-contact action. **Test:** `TEST-AI-04-04`.

## Offline/installable application and responsive layout

### OFF-01 — Installable application shell
- **OFF-01-AC3:** Given the application has been loaded successfully online, when the user installs it using the browser's supported install prompt and then launches it with network disabled, then the app shell, offline notice and navigation frame load without a network request for the shell assets. **Test:** `TEST-OFF-01-03`.
- **OFF-01-AC4:** Given cached business data is displayed offline, when the offline view is rendered, then each cached dataset displays its last-sync timestamp and STALE/OFFLINE label and server-authorized actions are disabled. **Test:** `TEST-OFF-01-04`.
### OFF-02 — Offline data and security boundary
- **OFF-02-AC3:** Given a user creates an explicitly offline-eligible draft, when connectivity returns, then synchronization submits a stable idempotency key and displays SYNCED, CONFLICT or FAILED with a retry action; it never silently overwrites a newer server version. **Test:** `TEST-OFF-02-03`.
- **OFF-02-AC4:** Given a user signs out, is revoked, or the configured cache expiry is reached, when protected cached content is next accessed, then the application clears or cryptographically locks that content and requires online reauthentication before protected data is displayed. **Test:** `TEST-OFF-02-04`.
### MOB-01 — Mobile layout stack (390×844)
- **MOB-01-AC3:** Given a 390×844 CSS-pixel viewport, when each of the 72 wireframes is rendered at device scale factor 1, then `document.documentElement.scrollWidth` is no greater than `document.documentElement.clientWidth`, and header, navigation/toolbar, page content and bottom actions occupy non-overlapping vertical regions. **Test:** `TEST-MOB-01-03`.
- **MOB-01-AC4:** Given a modal, keyboard, long label or validation message is displayed at 390×844, when the user scrolls and tabs through controls, then every actionable control remains reachable, focus is visible, and no fixed bar obscures the focused control. **Test:** `TEST-MOB-01-04`.
### MOB-02 — Desktop layout stack (1440×900)
- **MOB-02-AC3:** Given a 1440×900 CSS-pixel viewport, when each of the 72 wireframes is rendered at device scale factor 1, then document horizontal overflow is zero, the primary content is not obscured by sticky elements, and the navigation/content columns remain within the viewport. **Test:** `TEST-MOB-02-03`.
- **MOB-02-AC4:** Given a long table, dialog or expanded navigation is displayed at 1440×900, when the user resizes the viewport or navigates by keyboard, then content remains scrollable, controls remain operable and visible focus indication is preserved. **Test:** `TEST-MOB-02-04`.

## Backup, retention and disaster recovery — Board decision required

**TO BE APPROVED BY THE BOARD.** Proposed default only (not an approved policy): daily encrypted backups; 30-day rolling retention; monthly restore test; RPO 24 hours; RTO 48 hours. Legal hold, deletion exceptions, encryption/key custody, backup scope, off-site location and recovery authority remain Board decisions.

- **GOV-01-AC3:** Given the proposed backup schedule is enabled after Board approval, when a backup completes, then a manifest records backup ID, UTC completion time, source scope, encryption/integrity result, retention expiry and storage location identifier without exposing secrets. **Test:** `TEST-GOV-01-03`.
- **GOV-01-AC4:** Given a restore drill is authorized, when the operator restores to an isolated test environment, then the drill records measured RPO/RTO, integrity checks, missing objects and approver sign-off; production data is not overwritten. **Test:** `TEST-GOV-01-04`.
- **GOV-01-AC5:** Given a deletion or legal-hold request conflicts with the approved retention policy, when the request is submitted, then the system blocks the conflicting action and records the policy clause and approver required. **Test:** `TEST-GOV-01-05`.

## Extended traceability model

Each acceptance criterion is independently traceable using the following four-part key: **Requirement ID → Page/wireframe → Test ID → Acceptance criterion ID**. The `TEST-*` values are proposed test-case identifiers, not completed automated tests.

| Requirement family | Requirement IDs | Page mapping | Test mapping | Acceptance criteria |
|---|---|---|---|---|
| Top-level modules | MOD-01…MOD-31 | Exact page slug in each module heading | TEST-MOD-nn-03…05 | MOD-nn-AC1…AC5 (existing + addendum) |
| Nested sub-portals | SUB-01…SUB-15 | Exact child page slug in each sub-portal heading | TEST-SUB-nn-03…05 | SUB-nn-AC1…AC5 |
| Standalone portals | STD-01…STD-03 | dataset-registry; research-data-collection; release-readiness | TEST-STD-nn-03…06 | STD-nn-AC1…AC6 |
| Grant Intelligence AI | AI-01…AI-04 | grant-intelligence-and-funding-opportunities | TEST-AI-nn-01…04 | AI-nn-AC1…AC4 |
| Offline/mobile | OFF-01…OFF-02; MOB-01…MOB-02 | loading-error-empty-and-offline-states; application-shell-and-global-navigation | TEST-OFF/MOB-nn-01…04 | corresponding AC1…AC4 |
| Backup/DR | GOV-01 | release-readiness | TEST-GOV-01-01…05 | GOV-01-AC1…AC5 |
| Worker route families | API-01…API-59 | Route-specific page mapping in SRS route inventory; shared shell only where no dedicated page exists | TEST-PROPOSED-API-01…59 | API-nn-AC1…AC2; route schemas remain subject to source-level verification |

## Explicit route inventory disposition

The current SRS assigns `API-01` through `API-59` to the 59 documented Worker route/path families. **No unnumbered route family is identified in that documented inventory.** This does not establish that the inventory is exhaustive: delegated/nested routers and the earlier 66-family estimate remain an open source-inspection item. For each API requirement, the route-specific method, path, auth rule, request schema, success response schema, error response and side effects must be copied from its actual handler before its acceptance test is marked executable. Generic API criteria are not sufficient for production acceptance.

## Requirement counts after addendum

| Area | Requirement IDs | Existing ACs | Added ACs | Total ACs |
|---|---:|---:|---:|---:|
| 31 top-level modules | 31 | 62 | 93 | 155 |
| 15 nested sub-portals | 15 | 30 | 45 | 75 |
| 3 standalone portals | 3 | 6 | 12 | 18 |
| 4 Grant Intelligence AI requirements | 4 | 8 | 8 | 16 |
| Offline/mobile and governance requirements | 5 | 10 | 11 | 21 |
| 59 Worker route families | 59 | 118 | 0 | 118 |
| Cross-cutting traceability | 1 | 2 | 0 | 2 |
| **Total** | **118** | **236** | **169** | **405** |

**Count:** 93 + 45 + 12 + 8 + 11 = 169 additional criteria; total 405 acceptance criteria. The 10 cross-cutting requirement IDs are AI-01…AI-04, OFF-01…OFF-02, MOB-01…MOB-02, GOV-01 and TRC-01. This addendum does not convert proposed tests into executed tests.
