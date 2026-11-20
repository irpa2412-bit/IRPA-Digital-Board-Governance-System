# Administrator-Controlled Data Cleanup — Implementation Contract

Status: inventory-first administrator UI, expanded inventory, explicit cascade planning, durable Google Drive backup, version/protection revalidation, immutable cleanup audit events and bounded resumable execution are implemented on `feat/admin-controlled-cleanup-20261120`. Automated and isolated staging acceptance are in progress. Not merged or deployed. The legacy reset executor is disabled on this feature branch and is not approved for reuse.

## Objective
Replace the broad System Reset / trial-reset pathway with a dedicated Cloudflare Gateway service and Settings interface. The browser may inventory, select and review records; only the authenticated Worker may authorise and execute mutations. The Settings page is now connected to the inventory and plan endpoints.

## Authorisation
- Require a valid Firebase ID token and an active `adminProfiles/{uid}` record.
- Require the designated primary administrator identity; do not trust client-supplied role, email, UID or administrator flags.
- The application owner has confirmed that Daniel Mollel owns `irpa2412@gmail.com`, the web application, the administrator account, and the associated Gmail/Google Drive identity. Daniel Mollel is the sole web-app user and sole cleanup authority. The configured `PRIMARY_ADMIN_EMAIL` is therefore consistent with the owner-confirmed identity. The Worker must still authenticate the live Firebase UID and require its active `adminProfiles/{uid}` record; email ownership alone is not a substitute for token and role verification.
- Reject all other users with HTTP 403. Do not permit deletion of the executing administrator, Executive Director, Board Chairperson or Board Secretary.

## Inventory and selection
Inventory reads 105 Firestore collections spanning member/employee registers, administration, governance, meetings, documents/signatures, finance, procurement, research, grants, communications, job descriptions and system records, plus Firebase Auth accounts. Unlinked Auth accounts are displayed separately and are never misclassified as registered members. Full source documents remain server-side in the inventory snapshot; the browser receives a redacted review projection. Every inventory row carries its Firestore version and linked-record impact. Execution rejects stale versions and records with nested subcollections that cannot be safely reconciled. Nested child documents are not yet recursively inventoried; if a selected parent has child collections, execution reports their names and blocks deletion.
Every eligible record defaults to STAYS. GOES is an explicit per-record administrator decision. Provide full name, email, role, register category, creation date, status, record identifier, linked-record impact, search/filter, Mark all STAYS and live STAYS/GOES counters.
External signing invitees must not be treated as registered portal users unless a real member/profile record establishes that relationship.

## Member GOES
Remove only the selected member's register record, pending invitations, Firebase Auth account and unsent signing assignments. Block member GOES when the member is the signed-in administrator, a protected governance role, or a signer on a signed or in-progress envelope. Show the precise blocking reason. Signed documents and immutable audit evidence remain.

## Signed trial document GOES
For a signed signature-trial document explicitly marked GOES, first copy the referenced Drive file into the protected cleanup-backup folder, then delete its original signed PDF, signature-envelope record and associated trial-document portal record. Preserve immutable audit events and signing history. A normal signed document and its portal records remain protected.

## Meetings and other linked records
Meetings, invitations, participant rows, attendance, subscriptions, documents and envelopes are individually selectable. Do not cascade-delete unrelated linked records merely because a member or meeting is GOES. Show dependencies and impact before confirmation. The explicitly approved member cleanup and signed-trial-document rules above are the only permitted cascades.

## Two-phase protocol
1. Inventory and prepare: capture immutable record IDs, versions, selected GOES/STAYS rows, dependency map, protected rows and a deterministic deletion plan.
2. Review: show exact GOES list and consequences; require the administrator to type `DELETE`.
3. Execute: reauthenticate and reauthorise; recheck record versions and protection conditions; reject stale plans; execute bounded, resumable, idempotent batches; record each operation result. A partial run must never be reported as complete.
4. Backup: before the first mutation, create a durable Drive JSON archive containing plan ID, timestamp, administrator UID/email, all STAYS and GOES decisions, redacted original Firestore documents, IDs/relationships, intended scope, protection reasons, copies of selected Drive files, audit references and operation outcomes. Update the archive after each execution batch. Never include credentials or tokens.

## API contract
- `GET /api/admin/cleanup/inventory`
- `POST /api/admin/cleanup/plan`
- `GET /api/admin/cleanup/plan/:id`
- `POST /api/admin/cleanup/execute`
- `GET /api/admin/cleanup/status/:id`
- `GET /api/admin/cleanup/backup/:id`

All endpoints require server-side Firebase authentication and administrator authorisation. Inventory and plan endpoints must be read/plan only; no mutation occurs before typed confirmation and a valid plan.

## Technical constraints
- Cloudflare Gateway + existing Firebase/Firestore, Firebase Authentication and Google Drive.
- No Firebase Cloud Functions, no Firestore rules changes, no browser-held privileged credentials and no secret values in logs.
- Use the existing privileged Worker service-account path. Keep requests within Worker CPU/subrequest limits using bounded batches of at most 10 operations. Persist outcomes after each operation and allow a paused plan to resume without expanding its scope.
- Do not reuse `functions/systemControl.js` or the broad legacy reset executor: it spans unrelated collections and does not meet the narrow retention contract.
- Do not reuse the generic `/api/delete` route as a cleanup primitive; it is designed for controlled-document ownership checks, not the cross-collection cleanup contract.

## Acceptance tests
- All eligible rows default STAYS; only explicit GOES enters a plan.
- Mark-all-STAYS, search, filters, counters and exact review names work.
- Non-admin receives 403 and causes no mutation.
- Protected identities and signers on signed/in-progress envelopes are blocked with a reason.
- External invitees are not misclassified as members.
- Meeting dependencies are visible and independently selectable.
- Signed trial GOES removes PDF, envelope and portal record while retaining audit/signing history.
- Member GOES removes only the selected register row, linked pending invitations, Firebase Auth account and unsent signer assignments; unrelated meeting/document records remain independently selectable.
- A signed trial-document GOES copies the PDF to backup, removes the original PDF, envelope and linked trial portal record, and retains signatureEvents/audit history.
- Backup creation failure, stale version, changed dependency, Auth UID/email mismatch or nested Firestore subcollection prevents destructive execution.
- Missing/wrong DELETE, stale plans and changed protection state are rejected.
- Retries are idempotent; failed batches resume without expanding scope.
- Backup captures every STAYS/GOES decision and operation result.
- Regression tests cover existing meeting, invitation, document and signing workflows.

## Release gates
No production deletion during tests. Run automated tests and the cleanup-specific staging acceptance script with synthetic member, invitation, Auth and draft-envelope fixtures. The cleanup branch bypasses unrelated WordPress/cPanel read-write acceptance, which is not a cleanup prerequisite. Merge and deploy only after every required check and cleanup staging acceptance pass; verify the live Worker commit and cleanup endpoint health after deployment. Production execution remains a separate administrator action for explicitly selected records.
