# Protected portal change control

## Protected portals and shared dependencies
The authoritative path-to-portal map and baseline are in [portal-register.json](./portal-register.json). The initial baseline is `b766e7727722161f4f779bbd86d8ef21830eefa8`, verified by the production frontend deployment and live-build verification jobs on that commit. Portal-specific paths and existing automated tests are listed in the register. Shared paths fan out to every portal named against them. The map is an initial explicit ownership map and must be extended in the same PR whenever a newly discovered dependency is established.

## Repair-window rule

Every portal has its own isolated repair window and Change Record under `windows/<portal-slug>.json` and `records/<portal-slug>.json`. A protected PR must affect exactly one portal; shared dependencies fan out and multi-portal PRs fail. A window lasts exactly 72 hours from owner-approved opening or renewal. A warning is emitted when fewer than 12 hours remain. Windows cannot be renewed without an owner comment in the exact form `APPROVE <PR> <reason>` or `RENEW <portal> <reason>`; the renewal workflow quotes the exact comment in both portal records and `docs/approvals.md`. Every renewal is limited to one portal and never skips baseline smoke, portal lock tests or full regression. Break-glass remains limited to 24 hours.

The seven-day warning mode applies only to a newly registered portal explicitly marked `guardMode: "warning"` with a `registeredAt` timestamp. After seven days, missing or incomplete per-portal windows, Change Records or lock-test declarations block changes. Existing portals are protected immediately. Every portal must have its own repair window, Change Record and lock-test list.

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
Mark `emergency: true` in the window declaration and explain the emergency. The same strict scope and 72-hour inactivity closure apply. Complete the Change Record and tests before the repair is considered closed.

## Safety boundaries
This policy does not change branch protection, secrets, SMTP, Firestore rules, signing rules, certificates, hashes, archives or Worker code. Production deployment remains subject to the existing protected production environment and deployment workflow. Never rewrite history; rollback uses a new revert commit.


## Cross-portal wiring

Cross-portal communication must use an adapter boundary only. Each adapter must be guarded by a feature flag that defaults OFF and a kill switch. A wiring PR may not change a working portal's internal implementation; the affected portals' lock tests must remain unchanged and pass. Record adapter contracts and flag defaults in the relevant portal records.
