# Firebase Functional-Decoupling and Cloudflare Billing Migration

Status: **partial functional migration in progress; no production cutover or deployment has occurred**.

**Scope clarification:** remove FUNCTIONAL DEPENDENCY on Firebase for the Signature Portal, Meeting Portal and its sub-portals, and Authorisation & Approval workflows. This is not a request to delete Firebase globally or remove Firebase-hosted security rules. Preserve those rules unchanged. The specific blocker to resolve is the Google Cloud/Firebase billing dependency for functionality currently requiring Firebase Cloud Functions. Migrate those runtime operations to Cloudflare Workers and Cloudflare-backed services, so the portals remain functional without requiring Firebase Cloud Functions billing. Keep Firestore/rules or other Firebase components only where explicitly retained and compatible with the approved transition; do not silently rely on a Firebase callable for migrated functionality. The Cloudflare Gateway remains the API boundary. This document is not evidence that the migration has been implemented.

## Audited dependency points

- `src/firebase/signaturePlatform.js`: signature profiles, envelopes, signature events and workflow records are accessed directly through Firestore.
- `src/firebase/signerIdentity.js`: signer identity and authority state use Firestore; the existing callable path also uses Firebase Functions.
- `src/firebase/signatureStorage.js`: Gateway calls obtain Firebase ID tokens; signature and meeting archive operations use the Gateway, while Firebase remains the caller identity provider.
- `src/firebase/auth.js`, `src/firebase/functions.js`, `src/firebase/systemControl.js`: Firebase Authentication/Functions are used for login, credential-interview and administrative workflows.
- `src/firebase/meetingGatewayApi.js`, `src/components/MeetingAccessControl.jsx`, `src/pages/MeetingRoom.jsx`, and meeting pages/services: Firebase identity and/or Firestore-backed meeting state remains in the client path.
- Backend callable families include `functions/authorizationFunctions.js`, `functions/meetingRecords.js`, `functions/liveMeeting.js`, `functions/meetingAttendanceRegister.js`, `functions/passwordSecurity.js`, and callable exports in `functions/index.js`.
- `drive-gateway/src/index.js`, `drive-gateway/src/meetingPortal.mjs`, and `drive-gateway/src/meetingServices.mjs` currently authenticate Firebase tokens and read/write Firestore. The Worker configuration still requires `FIREBASE_PROJECT_ID`.

## Added scope: Finance Portal and Procurement Portal

These portals are included in the same branch and the same Google Cloud/Firebase Cloud Functions billing-blocker migration. Preserve their existing UI, approval sequence, financial controls, audit history, vendor records, purchase requests, quotations, purchase orders, delivery/invoice evidence, finance handoff, and controlled-document upload permissions.

### Finance Portal dependency points

- `src/pages/FinancePortfolio.jsx` uses `src/firebase/data.js` for finance registers, payment traces, record reads/writes, and payment processing.
- `src/components/FinanceTechnologyOperations.jsx` calls the generic `callFinanceAccounting` wrapper in `src/firebase/data.js`, which dispatches named Firebase callable functions for accounting operations.
- `src/components/FinanceAccountingEngine.jsx` and related finance components access finance data directly through the current data layer.
- Financial state transitions, period close, journal/posting operations, payroll/payment controls, donor restrictions, reconciliation, and audit writes must be server-enforced; the client UI must not become the authorization boundary.

### Procurement Portal dependency points

- `src/pages/ProcurementPortal.jsx` uses `src/firebase/procurement.js` and `src/firebase/data.js`.
- `src/firebase/procurement.js` performs direct Firestore reads/writes and transactions for vendors, requests, quotations, PR/PO numbers, approvals, evidence, performance scores, blacklisting/restrictions, audit entries, and finance handoff.
- Procurement's current client-side role checks are not sufficient as the only authorization boundary. Worker routes must derive actor identity from a verified session and validate procurement team membership, requester ownership, selected approver identity/role, allowed stage transitions, evidence ownership, and finance-handoff conditions on the server.

### Required migration sequence for these portals

1. Inventory every finance callable name and every Firestore collection/read/write/transaction used by Finance and Procurement; map each to a Cloudflare Worker operation and server-side authorization policy.
2. Implement authenticated Worker routes for finance operations and procurement workflow actions. Keep operations fail-closed until verified identity, role, register membership, record ownership, workflow state, and audit write are validated server-side.
3. Establish versioned Cloudflare persistence for transactional finance/procurement records, counters, and audit events. Do not point the portals at the existing generic Durable Object adapter until its concurrency, atomicity, query/indexing, retention, and audit guarantees meet these requirements; use D1 for transactional relational workflows where appropriate.
4. Migrate and reconcile existing Firestore records, counters, vendor restrictions, finance payment traces, approvals, and evidence references before enabling any client cutover. Verify record counts, foreign-key references, financial totals, and document hashes.
5. Switch client data adapters only after staging tests prove end-to-end parity. Preserve the existing Finance and Procurement UI and maintain a reversible, documented rollback.
6. Keep Firebase-hosted security rules unchanged and do not delete deployed functions. The objective is to make these portal operations independent of billing-blocked Firebase Cloud Functions, not to delete Firebase globally.

**Status of this added scope:** dependency audit and acceptance contract only. The Finance and Procurement client data paths still use Firestore, and finance callable dispatch still uses Firebase Functions. No Finance/Procurement cutover has been made. Treat this as an explicit incomplete gate, not a completed migration.

## Required replacement architecture

1. **Functional decoupling and billing:** move target runtime functionality currently blocked by Google Cloud billing for Firebase Cloud Functions into authenticated Cloudflare Worker routes/services. Preserve Firebase-hosted rules as requested; do not delete or rewrite them as part of this migration. Where existing Firebase Authentication or Firestore remains temporarily necessary, document it as a retained dependency and do not claim full decoupling until the affected target operation no longer requires Firebase billing or a Firebase callable. Replace Firebase ID-token dependence on migrated routes with a verified Cloudflare-compatible session/identity contract; never accept a client-supplied UID or role as proof of identity.
2. **Cloudflare persistence:** migrate governance identity, Member/Employee registers, signer profiles, envelopes, signature events, meeting records, access requests, attendance, decisions, approvals, and audit records into Cloudflare-managed storage (D1 for transactional records; private R2 for binary evidence where appropriate). Keep Drive only where intentionally retained for existing document/archive storage.
3. **Single authorization boundary:** move all sensitive reads/writes behind authenticated Worker APIs. Derive actor identity from the validated session; verify role, active register membership, record scope, workflow state and approval authority server-side. Make approval/signature state changes transactional and idempotent.
4. **Evidence integrity:** preserve signed-PDF bytes, cryptographic hashes, original/final document links, timestamps, signer identity/authority snapshots, audit chronology, controlled-document access, and historical records. Do not re-create, overwrite, or silently orphan historical signature evidence.
5. **Data migration and cutover:** export and reconcile source records, verify counts and hashes, run isolated staging end-to-end tests, then use a reversible cutover. Retain a documented rollback route until production acceptance. Do not disable Firebase or merge a partial cutover.

## Infrastructure prerequisites

- A provisioned Cloudflare D1 database and versioned schema migrations.
- Private R2 bucket(s) and access policy if binary evidence is moved from Drive.
- Cloudflare secrets for session signing, credential recovery mail, and any required external identity integration; secrets must not be committed to the repository.
- A deliberate account-recovery and MFA policy for current Firebase users. Existing Firebase passwords cannot be assumed portable to a new authentication system.
- A tested export/import process for Firestore data and a verified archive of historical signing evidence.

The current repository configuration exposes KV and a Durable Object binding, but does not establish that all required Cloudflare resources, identity/session migration, or production data migration are provisioned. Do not deploy a cutover until those prerequisites are verified. Firebase-hosted security rules must remain intact. The acceptance target is removal of functional dependence on Firebase billing/Cloud Functions for the three portal areas, not deletion of Firebase itself.

## Acceptance gates (all required before merge)

- Static and runtime checks prove that each migrated target operation no longer depends on Firebase Cloud Functions or Google Cloud billing to execute; Firebase-hosted rules remain unchanged. Any retained Firebase Authentication/Firestore dependency must be explicit, justified, and must not reintroduce the billing-blocked callable path.
- Automated tests cover unauthenticated access, privilege escalation, cross-user access, inactive or mismatched register entries, unauthorized approval, replay/idempotency, session expiry/revocation, concurrent approvals, and audit-write failure.
- Staging end-to-end acceptance covers signature creation, signing invitation, PDF retrieval/submission/verification, archive integrity, meeting creation/access, attendance, approvals, and authorization changes.
- Data migration reconciliation verifies record counts, key references, and hashes for all historical signed artifacts and audit evidence.
- Live production probes prove the migrated target workflows execute without requiring Firebase Cloud Functions billing; Firebase-hosted rules remain unchanged; rollback is tested.
- The complete test suite and application build pass. Only then is merge considered.

## Current stop point

Implemented first functional slice: password-attempt state, failure recording, and clearing are routed from `src/firebase/auth.js` to existing Cloudflare Worker endpoints backed by the `ESIGN_DO` Durable Object. Firebase Authentication remains the credential authority; Firebase-hosted rules are unchanged. A client migration regression test was added. The migration CI is being rerun after correcting its Firestore emulator setup.

Still incomplete: signature and signer-identity workflows, meeting records/access/attendance and sub-portals, Authorization & Approval workflows, remaining billing-blocked callable paths, Cloudflare identity/session design, persistent governance data model and data reconciliation. The existing adapter is not yet integrated into these workflows. No production cutover or deployment has occurred. Do not merge or claim completion until the full acceptance gates pass.
