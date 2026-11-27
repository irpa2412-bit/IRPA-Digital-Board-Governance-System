# IRPA production account backup — controlled runbook

## Scope

The owner-authorised one-time backup covers:
- Firebase Authentication user inventory (UID, sign-in identifiers, enabled/disabled state, provider metadata and custom claims).
- Firestore `members` collection records.
- A UID/email recovery mapping and an explicit list of unmatched or ambiguous identities.

The workflow does not export passwords, password hashes, refresh tokens, Firebase ID tokens, or service-account credentials. It does not create, disable, delete, replace, or modify Auth users or Firestore records.

## Separate Drive custody

The Drive Gateway provisions a dedicated root-level folder named **IRPA Account Backups (Restricted)**. It is not nested under the existing document, signature-profile, or meeting-archive partitions. The folder ID is stored in the Gateway's existing private `DRIVE_KV` namespace, not in source control or workflow logs.

Before provisioning or every upload/read-back, the Gateway verifies:
- The folder exists and is not trashed.
- The folder is owned by the configured `AUTHORIZED_DRIVE_EMAIL` custodian.
- The complete, paginated Drive permission list contains only that custodian as owner. Any additional user, group, domain, or public permission fails closed.
- Every uploaded backup file is stored directly in that dedicated folder.

If the current OAuth grant cannot create, read, or permission-check this folder, the operation fails. The workflow must not fall back to the document/profile/meeting folders or another Drive identity.

## Encryption and verification

The owner-initiated GitHub Actions workflow:
1. Requires the exact confirmation phrase `BACKUP IRPA PRODUCTION ACCOUNTS`.
2. Requires the existing production Firebase service-account secret, an enabled Firebase administrator email secret, and a separate 32-byte base64 AES key secret.
3. Reads Auth users and `members` records using the Admin SDK.
4. Creates a UID/email mapping; email-only matches and unmatched records are flagged for review.
5. Encrypts the complete snapshot in the runner's memory with AES-256-GCM and a fresh random IV.
6. Uploads only the encrypted envelope through the authenticated Gateway.
7. Reads the encrypted file back through Drive and compares its SHA-256 digest and byte length.
8. Re-reads the source UID and member-document ID inventories and fails the consistency gate if either set changed during the backup window.

Logs contain aggregate counts and pass/fail markers only. They must never contain record data, emails, UIDs, file IDs, tokens, encryption keys, or backup bytes.

## Recovery accounts and login verification

The first workflow creates no additional login accounts. Its encrypted mapping identifies UID matches, unique email-only candidates, ambiguous matches, missing Auth identities, and Auth-only identities. Recovery-account creation is a separate gated operation: do not create a second Auth account for an email already present in Auth, and do not create an account from an ambiguous or email-only match without validating the institutional identity and approved contact channel.

The inventory-stability check is not a sign-in test. Testing whether every original user can authenticate requires a controlled, user-approved authentication test method; passwords or refresh tokens must not be collected into this workflow. The workflow reports this distinction explicitly.

## Release boundary

This change adds the backup endpoint and manual workflow only. It does not deploy the Gateway, change Firestore rules, run a production export, or alter any account. Production backup execution must wait until the Gateway change is reviewed and deployed and the separate encryption/admin-email GitHub secrets are configured. Firestore-rules deployment remains subject to its existing explicit approval and release gates.

## PCU post-installation recovery

After the Portals Control Unit (PCU) has been installed and its production release verified, the owner can run **PCU Post-Installation Backup Recovery Preflight** from GitHub Actions. The workflow requires the exact `PCU INSTALLED` confirmation, the Drive backup file ID, the existing Firebase administrator secret, and the same 32-byte encryption key used for backup.

The preflight:
1. Retrieves the encrypted file only through the authenticated Gateway download route.
2. Rechecks the dedicated Drive folder custody and permission list, file parent, MIME type, size and SHA-256.
3. Decrypts the AES-256-GCM envelope and verifies the plaintext digest and expected Firebase project ID.
4. Compares backed-up Auth UIDs and emails against the currently installed Firebase project, and checks the backed-up `members` document IDs.
5. Reports whether PCU tenant collections are present after installation.

This preflight is deliberately read-only. It does not create Auth users, change claims, write member records, overwrite PCU governance records, change Firestore rules, or deploy PCU. It reports an aggregate readiness result only; no personal account data is written to GitHub logs or artifacts.

The backup created before PCU installation contains Firebase Auth inventory and `members` records. It does not contain PCU governance records created after installation. PCU's own tenant collections must therefore be backed up separately after installation before they can be restored from a later PCU snapshot.

**Restoration boundary:** the preflight distinguishes missing identities from UID/email conflicts. A conflict blocks readiness. Actual restoration must be a separately approved, additive operation: preserve existing UIDs and records; never overwrite a current identity or member document; require identity review for ambiguous mappings; and require users to reset passwords because the account backup intentionally contains no passwords or password hashes. Existing provider sessions are not recoverable and users will need to reauthenticate.

## Retention

This is a one-time backup workflow. It does not establish a recurring schedule, retention period, legal hold, RPO/RTO, or restore policy. Those remain subject to IRPA management approval under the SRS.
