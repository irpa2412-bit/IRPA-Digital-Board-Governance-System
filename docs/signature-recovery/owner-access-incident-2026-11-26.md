# Court envelope owner-access incident — 2026-11-26

## Authorisation and invariants
Owner authorisation is restricted to restoring owner access for `IRPA-ENV-2026-11501354` / `ENV-4b06e60941f8eb1d`. Do not delete, revoke, resend, re-sign, rotate tokens, change TRIAL/ACTUAL, overwrite records, or replace the original owner or signing evidence. A production backup must precede every production write or deployment that could affect this path.

## Read-only backup workflow
`.github/workflows/court-owner-access-backup.yml` scans and paginates production collections `envelopes`, `signatureEnvelopes`, `documents`, `signatures`, `signatureEvents`, and `signatureProfiles` using the production service-account secret. It exports the full collection contents plus matching Auth account metadata to an immutable GitHub Actions artifact and records byte length and SHA-256. It performs no Firestore writes and does not modify Auth accounts.
- Workflow execution and artifact creation must be verified before any repair.
- Drive copy is not included because the Google Drive connector is disabled by workspace administration; the Actions artifact is the first backup channel.
- This workflow does not have the user's current browser login UID/email. It discovers Auth accounts matching owner/sender/participant UID and email references stored in the envelope.

## Source-level authentication findings (main at inspection time)
1. `authenticateFirebaseRequest` validates the Bearer Firebase ID token's signature, issuer, audience, subject, and expiry, then calls `assertActivatedPortalUser`.
2. `assertActivatedPortalUser` obtains a Firestore admin token and reads `adminProfiles/{uid}`. If not active, it calls `getInstitutionalProfileForUser(env, claims)`.
3. The inspected definition of `getInstitutionalProfileForUser(env, claims, adminToken)` requires a third `adminToken` argument, but the call in `assertActivatedPortalUser` omits it. The helper then passes the missing token to Firestore reads. This is a concrete source-level defect in the fallback activation lookup.
4. The fallback helper searches only `members` and `employees`; it does not consider `signatureProfiles`. An owner who is active only in a personal Signature Portal profile can therefore fail the activation gate.
5. The recovery router catches every error from `authenticateFirebaseRequest` and returns HTTP 401 with a generic valid-sign-in message. This masks a 403 activation failure or a privileged Firestore identity error as `NOT_SIGNED_IN`/authentication failure.
6. The recovery route then separately calculates admin status from a custom claim, the hard-coded admin email, or an active admin profile. That logic is reached only after the authentication/activation gate succeeds. It does not make a personal signature profile an owner of an envelope.
7. Recovery ownership itself is strictly checked against `createdBy`, `createdByUid`, or `ownerUid` (or administrator status). No evidence currently supports adding a new UID alias to the Court envelope.

These findings are based on repository source inspection, not live Worker execution. They strongly explain the observed generic sign-in failure but do not establish the stored envelope/profile IDs or current browser UID.

## Worker configuration inspection
- `drive-gateway/wrangler.toml` declares production `FIREBASE_PROJECT_ID = irpa-digital-board-governance`.
- It binds Secrets Store secret `FIREBASE_SERVICE_ACCOUNT` from store `27d6d55c4704412bba09a56d1a999435`.
- The code supports `FIREBASE_SERVICE_ACCOUNT.get()` with fallback `FIREBASE_SERVICE_ACCOUNT_JSON`.
- This static configuration does not prove the live Worker has the binding or that the secret is readable.
- No live Worker version or historical last-good version was available from the connected tools at inspection time. Do not roll back without a verified version and backup.

## Current completion state
- No production record read, export, or artifact has yet been verified.
- No live ownerUid/senderUid/participantUids, document owner, signatureProfile, Auth account, or duplicate-account comparison is available yet.
- No production writes, ownership alias, code fix, rollback, merge, deployment, or Playwright run performed.
- The source defect is identified, but fix-forward is gated on successful backup and live identity comparison. A safe fix should pass the admin token, include active signature-profile activation where appropriate, and preserve strict envelope owner checks. Do not add an alias until a live comparison proves the current UID and the existing owner record.
