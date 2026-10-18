# Firebase-Free Governance Workflow Migration

Status: **scope and acceptance contract only; no production workflow has been switched**.

This migration is intended to remove Firebase Authentication, Firestore, and Firebase callable-function dependencies from the Signature Portal, Meeting Portal and its sub-portals, and Authorization & Approval workflows. The Cloudflare Gateway remains the application API boundary. This document is not evidence that the migration has been implemented.

## Audited dependency points

- `src/firebase/signaturePlatform.js`: signature profiles, envelopes, signature events and workflow records are accessed directly through Firestore.
- `src/firebase/signerIdentity.js`: signer identity and authority state use Firestore; the existing callable path also uses Firebase Functions.
- `src/firebase/signatureStorage.js`: Gateway calls obtain Firebase ID tokens; signature and meeting archive operations use the Gateway, while Firebase remains the caller identity provider.
- `src/firebase/auth.js`, `src/firebase/functions.js`, `src/firebase/systemControl.js`: Firebase Authentication/Functions are used for login, credential-interview and administrative workflows.
- `src/firebase/meetingGatewayApi.js`, `src/components/MeetingAccessControl.jsx`, `src/pages/MeetingRoom.jsx`, and meeting pages/services: Firebase identity and/or Firestore-backed meeting state remains in the client path.
- Backend callable families include `functions/authorizationFunctions.js`, `functions/meetingRecords.js`, `functions/liveMeeting.js`, `functions/meetingAttendanceRegister.js`, `functions/passwordSecurity.js`, and callable exports in `functions/index.js`.
- `drive-gateway/src/index.js`, `drive-gateway/src/meetingPortal.mjs`, and `drive-gateway/src/meetingServices.mjs` currently authenticate Firebase tokens and read/write Firestore. The Worker configuration still requires `FIREBASE_PROJECT_ID`.

## Required replacement architecture

1. **Cloudflare identity and sessions:** replace Firebase ID tokens with short-lived, revocable server-managed sessions. Store password verifiers or federated identity links safely; protect login, recovery, session renewal, logout, rate limits, and administrator MFA. Never accept a client-supplied UID or role as proof of identity.
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

The current repository configuration exposes KV and a Durable Object binding, but does not establish that the required D1/R2 resources, migrated identity credentials, or production data migration are provisioned. Do not deploy a Firebase-free cutover until those prerequisites are verified.

## Acceptance gates (all required before merge)

- Static scan shows no Firebase Auth, Firestore, Firebase Functions, Firebase SDK initialization, ID-token dependency, or Firebase project configuration on any target workflow path.
- Automated tests cover unauthenticated access, privilege escalation, cross-user access, inactive or mismatched register entries, unauthorized approval, replay/idempotency, session expiry/revocation, concurrent approvals, and audit-write failure.
- Staging end-to-end acceptance covers signature creation, signing invitation, PDF retrieval/submission/verification, archive integrity, meeting creation/access, attendance, approvals, and authorization changes.
- Data migration reconciliation verifies record counts, key references, and hashes for all historical signed artifacts and audit evidence.
- Live production probes prove the target workflows operate without Firebase services; rollback is tested.
- The complete test suite and application build pass. Only then is merge considered.

## Current stop point

This branch contains this dependency audit and acceptance contract only. It does not yet implement the new identity/session system, D1/R2 persistence, data migration, or replace the Firebase-dependent application paths. It must not be represented as a completed migration or deployed.
