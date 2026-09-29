# IRPA-DBGS Cloudflare Routing Baseline

This branch is an isolated routing and transaction-control baseline. It does not migrate the production Firebase application.

## Authoritative services

- Firebase Authentication remains authoritative for identity.
- Firestore remains authoritative for transaction metadata and authorization state.
- The existing IRPA Gateway remains authoritative for portal and authority decisions.
- The existing Firebase/authoritative service remains the origin until a later, separately verified migration.

## Controlled routes

Document:
- /api/document/reference
- /api/document/upload
- /api/document/save
- /api/document/archive
- /api/document/classify
- /api/document/download
- /api/document/restore

Signature:
- /api/signature/prepare
- /api/signature/sign
- /api/signature/verify
- /api/signature/code
- /api/signature/certificate
- /api/signature/archive
- /api/signature/pdf-transfer

Transaction/audit:
- /api/transaction/start
- /api/transaction/commit
- /api/transaction/rollback
- /api/transaction/status
- /api/audit/event

Email:
- /api/email/transaction
- /api/email/notification

The email routes preserve Firebase Authentication and Firestore as the authoritative identity and transaction context. They are routing endpoints, not an independent authorization system.

## Signature PDF baseline

/api/signature/pdf-transfer validates that the submitted artifact is a PDF, calculates a server-side SHA-256 hash, and returns a transaction envelope. It does not replace the existing production storage workflow.

The intended later workflow is:

Firebase Authentication
-> IRPA authority
-> Cloudflare transaction route
-> Firebase/Firestore transaction state
-> signed PDF
-> authorized persistent storage
-> certificate
-> audit

## Production protection

There is deliberately no Cloudflare deployment step in this baseline workflow. This branch is isolated from production main. No Firebase Hosting, Firebase Functions, or existing production Cloudflare Worker deployment is modified by this baseline.

## Second testing layer

After the isolated baseline passes:

1. Route against a non-production Firebase origin.
2. Verify Firebase ID-token handling and IRPA Gateway authority context.
3. Test document-reference allocation and idempotency under concurrency.
4. Test Firestore email transaction recording and delivery paths.
5. Test signed-PDF persistence, certificate binding, and audit records.
6. Only after those tests succeed should a controlled production route activation be considered.
