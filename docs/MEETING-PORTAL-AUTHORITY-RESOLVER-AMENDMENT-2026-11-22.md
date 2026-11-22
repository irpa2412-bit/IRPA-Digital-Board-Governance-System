# Meeting Portal authority resolver amendment — 22 November 2026

- Owner instruction: permanent full Meeting Portal access for the Director of Internal Oversight (including historical spelling variants), Executive Director and every Head of Department, until owner revocation. The 72-hour period is the repair window, not a grant expiry.
- PR #863; branch `fix/meeting-operational-access-implementation-20261122`; baseline `e1002e1784214d881695f8f5fe1e1067da79b7dc`.
- Change: recognize `Director of Internal Oversight`, `Internal Oversight Director`, `Director Internal Oversight`, and historical `Director of International Oversight` as the same registered authority; normalize repeated whitespace correctly.
- Authority sources: active Members and Employees records linked by UID, email, member number or employee number, plus institutional department-head records. Inactive, revoked, suspended and expired records remain denied.
- Tests: add seeded title-variant and whitespace-normalization cases while preserving existing identity-key, multi-role, department-head, inactive and member-only/employee-only coverage.
- Boundaries: no Firestore rules, secrets, environment variables, SMTP, signature workflow, production data or branch protection changes.
- Status: resolver amendment committed for PR validation; merge/deployment remain gated on required checks and review.
