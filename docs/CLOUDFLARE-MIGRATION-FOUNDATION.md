# IRPA-DGBS Cloudflare Migration Foundation

Status: controlled migration foundation; production cutover not enabled.

## Objective

Move infrastructure responsibilities away from Firebase-hosted server execution in a bounded, reversible sequence while preserving the existing IRPA-DGBS governance model.

## Target responsibilities

- Cloudflare Workers: trusted API/server execution.
- Cloudflare D1: relational application data only after schema mapping and dual-read validation.
- Cloudflare R2: application object storage where required.
- Cloudflare Pages/Workers: web delivery where validated.
- Cloudflare DNS: authoritative DNS/edge control.
- Google Drive/Shared Drive: institutional document repository.
- mail.irpa.or.tz: institutional mail service; keep mail host DNS-only unless a supported mail proxy is explicitly established.

## Non-negotiable migration rules

1. Do not delete or disable Firebase production during migration.
2. Do not change authentication providers until an equivalent identity and recovery path is verified.
3. Do not migrate Firestore data by inference. Produce an explicit collection/schema mapping first.
4. Do not expose credentials in source, Vite bundles, GitHub Actions logs, or committed configuration.
5. Do not put SMTP credentials in the application.
6. Preserve document IDs, workflow IDs, signer identities, signature records, hashes and audit history.
7. Central Authorisation & Approval remains the security policy boundary.
8. Google Drive permissions supplement, but do not replace, IRPA-DGBS authorisation.
9. Production DNS changes require verified target records and rollback records.
10. Cutover requires parallel validation and a tested rollback path.

## Migration gates

### Gate 1 — Cloudflare inventory
Required: verified Workers/Pages/D1/R2/KV/routes/environment configuration.

### Gate 2 — API parity
Required: server-side replacements for currently required callable operations, including authorisation operations.

### Gate 3 — data parity
Required: explicit Firestore-to-target schema mapping, migration checksum/reconciliation and read validation.

### Gate 4 — identity parity
Required: authentication, invitation, recovery and role/permission behaviour verified without weakening controls.

### Gate 5 — document parity
Required: Google Drive repository adapter, file IDs, hashes, versions and permission mapping verified.

### Gate 6 — parallel production validation
Required: production-like validation without changing the active production route.

### Gate 7 — controlled cutover
Only after Gates 1–6 pass. Preserve Firebase rollback until post-cutover verification is complete.

## Current boundary

This commit intentionally establishes the migration contract only. It does not switch production traffic, replace Firebase calls, migrate Firestore data, change DNS, or alter authentication.

The private Cloudflare migration-blueprint repository supplied separately is the authoritative source for Cloudflare-specific resource identifiers and bindings when it becomes accessible to the implementation environment. No Cloudflare resource ID, route, account ID, D1 database ID, R2 bucket, or DNS target is invented here.
