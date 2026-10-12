# IRPA-DBGS Assessment Remediation Runbook
**Assessment date:** 12 October 2026  
**Purpose:** Track implementation of the repository assessment without changing production data or service routing before verification.

## Immediate code and CI controls
- [x] Create an isolated remediation branch from `main`; do not modify the frozen staging infrastructure proof branch or PR #145.
- [x] Move PDF.js to the patched 6.2.108-or-later line.
- [x] Replace the vulnerable `xlsx@0.18.5` package with the API-compatible `@e965/xlsx` package alias.
- [x] Add a high-severity npm audit blocker and reproducible lockfile-based CI installs.
- [x] Add a Playwright production-build app-shell smoke test with screenshot/trace artifacts.
- [ ] Confirm the regenerated lockfile is committed and the GitHub Actions dependency audit is clean.
- [ ] Confirm all application build, policy, Firestore emulator and browser checks pass on the exact PR head.

## Required release procedure
1. Protect the reviewed `main` commit with a backup tag before promotion.
2. Use pull requests only; do not commit interface fixes directly to `main`.
3. Require the dependency audit, production build, Firestore rules emulator, governance-policy tests and Playwright browser checks to pass.
4. Review the generated dashboard screenshot at 1440px and mobile width for interface changes.
5. Deploy to a preview/staging target and verify the actual URL and commit identity before production promotion.
6. Keep Firebase Hosting at `https://irpa-digital-board-governance.web.app/` as the intended production address until the owner approves a measured cutover. Do not delete or redirect the existing Cloudflare endpoint without verifying its users and dependencies.
7. Record the deployed commit SHA, workflow run, endpoint smoke-test result and rollback target.

## Firebase operational controls — console/project access required
These controls cannot safely be completed from source code alone. Configure them in the Firebase/Google Cloud project, then record the evidence here.

- [ ] Enable Firebase App Check for the actual web app using a registered provider/site key; test in monitoring mode first, then enforce for the intended Firebase services only after legitimate clients are verified.
- [ ] Restrict the Firebase web API key by approved HTTP referrers and required APIs. Verify local, preview and production domains separately.
- [ ] Enable application error monitoring with a named alert recipient. Do not put a monitoring DSN or private key in source control.
- [ ] Create a separate backup bucket with least-privilege export/import permissions and retention/lifecycle policy.
- [ ] Configure scheduled Firestore exports to the separate bucket; verify export completion and alert on failure.
- [ ] Rehearse a restore into a non-production project/database and record counts, indexes, rules and measured recovery time before claiming recoverability.
- [ ] Verify at least two named administrators have access to the repository, Firebase project and Cloudflare account.

## Next 30 days — maintainability and performance
- [ ] Split `src/App.jsx` by responsibility (navigation, dashboard/topbar and session) using behavior-preserving changes with screenshot tests.
- [ ] Replace dashboard/weather CSS override layering with a scoped component stylesheet and existing design tokens; remove duplicate/dead rules only after screenshot comparison.
- [ ] Add ESLint and Prettier in a separate PR with a baseline that avoids unrelated mass reformatting.
- [ ] Replace silent catches with structured error handling or logging; never log credentials, tokens, signatures or sensitive member/finance records.
- [ ] Lazy-load portals and heavyweight PDF, spreadsheet, LiveKit and presentation dependencies; measure the production bundle before and after each change.
- [ ] Extend Playwright coverage to sign-in, meeting-to-vote and signature flows using controlled test identities and non-production data.

## Next 90 days — independent assurance and governance evidence
- [ ] Commission an independent penetration test and privacy/data-protection review with counsel against Tanzania's Personal Data Protection Act, 2022.
- [ ] Implement dedicated Decisions, Actions, Risk Register, Reports and Audit Trail views; verify traceability from meeting through resolution, approval and payment.
- [ ] Train named pilot users and measure meeting adoption, resolution-to-action time, paper/email reduction and open audit points.
- [ ] Update the README, architecture documentation and operator runbooks.
- [ ] Obtain independent approval before unrestricted rollout or representing the platform as auditor-validated.

## Acceptance criteria
The pilot can be considered ready for controlled use only when high-severity dependency findings are cleared, security-rule and browser tests pass on the exact candidate, the single production endpoint is documented, error alerts reach a named person, and a backup restore has been rehearsed. A source-code change alone does not prove that Firebase/Cloudflare console controls or a production deployment are complete.
