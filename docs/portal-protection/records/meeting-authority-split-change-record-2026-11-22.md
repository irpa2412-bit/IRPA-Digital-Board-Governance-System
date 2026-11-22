# Change Record — Meeting Portal authority split

- Change ID: MP-2026-11-22-OWNER-FULL-ACCESS-SPLIT
- Portal: Meeting Portal only
- Source PR: #863 (not used as the implementation vehicle)
- Base: main at faba56ea18610256b635ed6bfaa6def68b1b11a6
- Repair window: 72 hours; implementation/validation window only.
- Access duration: permanent until owner revocation; inactive, revoked, suspended or expired register entries deny on the next request.
- Intended authority: Director of Internal Oversight (including the stated title variants), Executive Director, and every Head of Department, resolved from active Members, Employees and department-head register records by UID, email, member number, employee number and department records.
- Implementation constraint: Meeting-only client and Worker authority modules; no shared application files, signature files, Firestore rules, secrets, environment variables, SMTP settings, signing rules, sessions, signer identity, field assignment, stamping, PDF, hash, certificate or archive logic.
- Required verification: same authority decision on Meeting screens and Worker routes; specific duty denial; seeded tests for every identity key, multiple roles, inactive/revoked/expired entries, ordinary member, guest and outsider; quorum remains one-third rounded up and existing voting rules remain enforced.
- Attendance callables: separate follow-on Meeting-only change after this authority PR.
- Status: split branch initialized from latest main. This record is a planning/traceability commit only; no authority code, tests, merge or deployment is claimed by this commit.
