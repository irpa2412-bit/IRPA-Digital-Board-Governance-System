# PR #895 verification snapshot — 2026-11-22

## Scope and repair authorisation

- PR: #895
- Branch: `feat/owner-signature-recovery-screen-20261122`
- Repair window: Signature Portal, 72 hours.
- Current window: opened `2026-11-22T15:35:28.470Z`, expires `2026-11-25T15:35:28.470Z`.
- Owner approval for the read-only recovery screen: https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/895#issuecomment-7081030720
- Owner approval extending the scope to isolate recovery access telemetry from envelope records: https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/895#issuecomment-7081418969

## Immutable production baseline evidence

All three separately named jobs checked out exact baseline commit `25ddcc6d8f89b6a4103c37a254fbd2af0c26febe` and passed in workflow run `45039296254`:

| Job | Job ID | Result |
|---|---:|---|
| baseline-smoke | 137259916753 | PASS |
| full-regression | 137259917115 | PASS |
| signature-portal-smoke | 137259917010 | PASS |

Job logs verify the exact baseline checkout command. The full-regression job ran `npm run test:all` under the Firestore emulator. The Signature Portal job also checked out the PR head and passed both the owner-panel GET-only guard and Gateway recovery no-mutation regression.

## Initial failed attempt — retained, not hidden

Workflow run `45038527520` initially failed its `full-regression` job (`137257570674`) because the Firestore emulator had not been started. Fifteen tests in `tests/meeting-category-firestore-rules.test.cjs` failed during emulator initialisation; the error stated that the Firestore emulator host and port were unspecified. The other two jobs in that first run passed. The workflow was corrected to run the full suite under `firebase emulators:exec --only firestore`; the complete rerun `45039296254` passed all three jobs.

## Read-only integrity correction

Source review found the existing recovery GET handlers appended access events to the envelope's `events` array and changed its `updatedAt` value. That violated the explicit no-envelope-write boundary. The access telemetry was moved to the separate `recoveryAccessEvents` collection. The Gateway test now snapshots the complete envelope and proves queue, evidence assessment and preview leave it unchanged, including signers, fields, signing events and version metadata. The owner-panel test separately enforces GET-only requests, an allowlist of read endpoints, no persistence/action APIs and no direct Completed status assignment.

## Change Record and release

The Signature Portal Change Record is now marked `complete` with exact changed files, prohibited changes, baseline/rollback commit, repair-window reference, three job-level evidence links, the initial failed attempt, and PR-head run IDs.

At this snapshot, PR-head checks have been triggered again on the Change Record commit. Merge and production deployment are NOT VERIFIED. Do not deploy or mutate the affected production envelope before all required checks pass and the protected PR is merged.
