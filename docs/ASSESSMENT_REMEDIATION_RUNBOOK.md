# IRPA-DBGS Assessment Remediation Runbook
**Assessment date:** 12 October 2026  
**Purpose:** Track implementation of the repository assessment without changing production data or service routing before verification.

## Immediate code and CI controls
- [x] Create an isolated remediation branch from `main`; do not modify the frozen staging infrastructure proof branch or PR #145.
- [x] Move PDF.js to the patched 6.2.108-or-later line.
- [x] Replace the vulnerable `xlsx@0.18.5` package with the API-compatible `@e965/xlsx` package alias.
- [x] Add a high-severity npm audit blocker and reproducible lockfile-based CI installs.
- [x] Add a Playwright production-build app-shell smoke test with screenshot/trace artifacts.
- [x] Regenerate and commit the lockfile; pin patched `@grpc/grpc-js` and `basic-ftp`, and move the watcher dependency to `chokidar` 4.x to remove the unpatched `braces` advisory from the resolved tree.
- [x] Add ESLint, desktop/mobile Playwright smoke tests, portal-registry and dashboard-style wiring tests, and a Firestore Emulator regression step to the remediation workflow.
- [x] Preserve the newer dashboard hero implementation on `main` and its existing headless layout check. The merge deliberately does not reintroduce the removed `public/dashboard-hero-fix.js` script or its temporary stylesheet; review the headless layout evidence on the merged candidate.
- [x] Add opt-in Firebase App Check initialization for both the primary and applicant Firebase app instances, controlled by `VITE_FIREBASE_APPCHECK_SITE_KEY`.
- [ ] Run and inspect the dependency audit, production build, lint, Firestore emulator suite, and desktop/mobile browser tests on the exact final PR head. The most recent lockfile-refresh audit output reported 10 moderate findings and no high/critical findings; the final candidate still needs a fresh, dedicated audit.

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

- [ ] In Firebase Console for project `irpa-digital-board-governance`, register the web app with reCAPTCHA v3 under App Check and place the resulting **site key** in the protected build environment as `VITE_FIREBASE_APPCHECK_SITE_KEY`. Do not use the secret reCAPTCHA key in the browser build.
- [ ] Leave App Check in monitoring mode first. Verify valid requests from the main app and the named `irpa-applicant-enrollment` app; then enforce Firestore and any supported services individually after the dashboard shows legitimate traffic.
- [ ] In Google Cloud Console → APIs & Services → Credentials, restrict the Firebase web API key to the actual production/preview/local HTTP referrers and only the APIs required by the app. Test login, password reset, invitation activation, Firestore reads/writes and applicant enrollment before saving a final allowlist.
- [ ] Configure Cloud Logging/Error Reporting and a Cloud Monitoring alert policy for frontend/backend error spikes, failed scheduled exports and Firebase Functions errors. Add a named IRPA operator recipient and perform a test notification; do not put private monitoring keys in source control.
- [ ] Create a dedicated Cloud Storage bucket in an appropriate region with uniform bucket-level access, public access prevention, retention/lifecycle policy and least-privilege export/import IAM. Do not use a public bucket or the application upload bucket.
- [ ] Configure a daily scheduled Firestore export to the dedicated bucket using a service account limited to the required Firestore export and bucket permissions. Confirm at least one completed export, inspect the operation status, and alert on missed/failed runs.
- [ ] Rehearse a restore into a non-production project/database. Record exported collection counts, indexes/rules re-deployment steps, restore duration and measured recovery point; do not claim recoverability until this rehearsal passes.
- [ ] Verify at least two named administrators have access to the repository, Firebase project and Cloudflare account.

## Next 30 days — maintainability and performance
- [x] Begin the `src/App.jsx` decomposition by extracting the portal registry and navigation components into dedicated modules; continue extracting dashboard/topbar and session responsibilities in separate behavior-preserving changes.
- [ ] Reduce dashboard/weather `!important` override layering and migrate hard-coded colors to approved design tokens only after desktop/mobile screenshot comparison; do not alter the approved layout based on source inspection alone.
- [x] Add an ESLint flat-config baseline for the app shell, navigation modules, and smoke-test configuration; extend coverage incrementally to avoid unrelated mass reformatting.
- [ ] Add Prettier check in a follow-up once the formatting baseline is agreed; do not mass-format the 459 KB app stylesheet or 135 KB App component as part of this remediation.
- [ ] Replace silent catches with structured error handling or monitored reporting; never log credentials, tokens, signatures or sensitive member/finance records.
- [x] Lazy-load the meeting room, signature, finance and procurement portals behind explicit loading fallbacks.
- [ ] Measure production bundle size and add authenticated Playwright flows for sign-in, meeting-to-vote and signature using controlled test identities and non-production data.

## Next 90 days — independent assurance and governance evidence
- [ ] Commission an independent penetration test and privacy/data-protection review with counsel against Tanzania's Personal Data Protection Act, 2022.
- [ ] Implement dedicated Decisions, Actions, Risk Register, Reports and Audit Trail views; verify traceability from meeting through resolution, approval and payment.
- [ ] Train named pilot users and measure meeting adoption, resolution-to-action time, paper/email reduction and open audit points.
- [ ] Update the README, architecture documentation and operator runbooks.
- [ ] Obtain independent approval before unrestricted rollout or representing the platform as auditor-validated.

## Acceptance criteria
The pilot can be considered ready for controlled use only when high-severity dependency findings are cleared, security-rule and browser tests pass on the exact candidate, the single production endpoint is documented, error alerts reach a named person, and a backup restore has been rehearsed. A source-code change alone does not prove that Firebase/Cloudflare console controls or a production deployment are complete.
