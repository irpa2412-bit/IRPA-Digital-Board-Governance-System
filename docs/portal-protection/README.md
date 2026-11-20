# Protected portal change control

## Protected portals and shared dependencies
The authoritative path-to-portal map and baseline are in [portal-register.json](./portal-register.json). The initial baseline is `b766e7727722161f4f779bbd86d8ef21830eefa8`, verified by the production frontend deployment and live-build verification jobs on that commit. Portal-specific paths and existing automated tests are listed in the register. Shared paths fan out to every portal named against them. The map is an initial explicit ownership map and must be extended in the same PR whenever a newly discovered dependency is established.

## Repair-window rule
A window has no fixed expiry. It stays open while authorised repair activity continues. Each protected repair commit is timestamped in Git and resets the inactivity clock. It closes automatically when 24 consecutive hours pass without repair activity. The check computes the effective status from the last activity timestamp; an expired window is treated as closed even if the declaration file has not yet been edited. A closed window requires a fresh declaration. Emergency designation is recorded separately and does not change the 24-hour rule; a complete Change Record remains mandatory.

## One-command portal regression run\nRun `npm run test:protected-portals` to execute the registered regression tests for all seven portals and print a PASS/FAIL table. These are the currently mapped automated tests; they do not substitute for browser-level page-load and Worker-route smoke tests where those fixtures are not available.\n\n## Opening a window
Send: `Open repair window: [portal], reason [reason], files [exact files].`
The declaration must identify every affected portal (including shared dependents), exact paths, expected effect, prohibited changes, baseline and rollback commit. Record the declaration in `repair-window.json` and every subsequent repair activity in its timestamped activity log. Scope is exact: an unlisted protected file fails the gate.

## Required laydown
1. Declare affected portals, reason, exact files, expected effect and prohibited changes.
2. Run baseline smoke tests before edits.
3. Open the repair window and record the rollback commit.
4. Inspect affected code read-only before editing.
5. Work on an isolated branch; change only declared files.
6. Run each affected portal smoke test, all dependent tests for shared files, and full regression.
7. Compare against baseline and record every behaviour difference.
8. Merge only through the protected PR path; deploy through the existing production workflow and verify the live commit.
9. Close the window, record final/rollback commits and test evidence, and update the baseline.
10. Save the plain-language record in this directory.

## Change record and merge gate
For a protected change, add a completed record based on [change-record-template.json](./change-record-template.json). The PR must declare affected portals and include steps 1, 3, 7 and 9. The policy validator runs inside the existing `security-baseline`, `integrity` and `Readability Checker and Independent Verifier` checks. Missing records, closed/expired windows, out-of-scope paths, missing dependent smoke evidence, or missing baseline/rollback evidence fail the gate. Changes outside registered portal/shared paths do not require a repair window.

## Emergency repairs
Mark `emergency: true` in the window declaration and explain the emergency. The same strict scope and 24-hour inactivity closure apply. Complete the Change Record and tests before the repair is considered closed.

## Safety boundaries
This policy does not change branch protection, secrets, SMTP, Firestore rules, signing rules, certificates, hashes, archives or Worker code. Production deployment remains subject to the existing protected production environment and deployment workflow. Never rewrite history; rollback uses a new revert commit.
