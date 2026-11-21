# IRPA-DBGS protection roadmap — resumable status

Updated: 2026-11-21 (UTC)

| Stage | State | PR | Commit SHA | Run link | Next step |
|---|---|---|---|---|---|
| 0. Firestore publication safeguard | MERGED; PR diff contains no Firestore rules/index files. Merge commit has 17 successful, 10 skipped and 1 failed check; do not call the complete merge-commit suite green. | [#843](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/843) | `5fa8d46deeeb96c3172a1798411c18f57991855d` | [Checks](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/commit/5fa8d46deeeb96c3172a1798411c18f57991855d/checks) | Investigate the failed `build-and-regression` check; verify live deployment and rollback versions before marking release complete. |
| 0A. REAL/TRIAL deletion hotfix | OPEN; code and contract tests submitted; CI runs queued/in progress at last retrieval. Tier 1 owner approval required before merge. No production deployment. | [#845](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/845) | `afcedc2a9a8bd93c2dea4dc9f830e10f13bbb60f` | [Checks](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/commit/afcedc2a9a8bd93c2dea4dc9f830e10f13bbb60f/checks) | Wait for CI; inspect all failures; run focused tests and rerun once after any fix; request exact `APPROVE 845 <reason>` only when green. |
| 1. Portal/module register | NOT STARTED; current register has seven named portals but omits tier/status, Worker route inventory, dependency and acceptance-test coverage. | — | — | — | Inventory every app portal/module, Worker route, collection, test and dependency before assigning PROTECTED. |
| 2. Lock tests and Worker contracts | NOT STARTED; existing tests are not yet proven to satisfy the requested full end-to-end lock acceptance for each portal. | — | — | — | Build emulator-only acceptance suites; do not rewrite existing lock tests to make a change pass. |
| 3. Narrow pathway and main protection | PARTIAL BASELINE; main branch reports protected=true; required settings not yet inspected/proven. | — | — | — | Inspect protection rules; implement portal-scoped PR check, templates, size warning and branch policy. |
| 4. Guards and exits | NOT STARTED | — | — | — | Implement warning periods, day-one Tier 1 blockers, approval ledger, break-glass path, false-alarm report and discarded-PR exit tests. |
| 5. Worker runtime protection | NOT STARTED | — | — | — | Audit routes and implement server-side controls without weakening sign-in, invitations or signing. |
| 6. Recovery and exports | NOT STARTED | — | — | — | Build rollback workflow and protected daily governance-record export; no rules publication without `DEPLOY RULES`. |
| 7a. Portal adapters | NOT STARTED | — | — | — | One adapter per portal, flags OFF, kill switches and unchanged lock-test proof. |
| 7b. Meeting Portal | NOT STARTED; existing meeting feature PRs must be reconciled in the requested order. | [#826](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/826), [#827](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/827), [#815](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/815), [#812](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/812), [#813](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/813) | — | — | Reconcile after protection pathway; full meeting-chain test required. |
| 7c. Signature adjustments | NOT STARTED | — | — | — | Preserve signing protocol; implement cancellation and responsive bottom action bar only after approval and lock-test baseline. |

## Stage 0A implementation details

- Only an explicit `TRIAL` value at creation by an authenticated administrator is stored as `TRIAL`; all other values are stored as `REAL`.
- The meeting update route ignores attempts to change `environment`.
- Meeting-register deletion requires an explicit `TRIAL` environment; missing/invalid values fail closed as `REAL`.
- Final meeting-record purge also requires the linked meeting to be explicitly `TRIAL`, in addition to existing administrator, legal-hold, retention, pending-review and version checks.
- New helper: `drive-gateway/src/meetingEnvironment.mjs`; tests: `drive-gateway/tests/meeting-environment.test.mjs`.
- This is Tier 1 deletion protection. Do not merge without the owner's exact approval after green checks.

## Release evidence and safety boundaries

- PR #843 merge SHA: `5fa8d46deeeb96c3172a1798411c18f57991855d`; its diff did not modify `firestore.rules` or `firestore.indexes.json`. This establishes no rules-file change in that PR, not a claim about unrelated deployments.
- PR #843 merge-commit checks: 17 success, 10 skipped, 1 failure (`build-and-regression`). Run/check evidence: [GitHub checks](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/commit/5fa8d46deeeb96c3172a1798411c18f57991855d/checks).
- PR #845 head SHA at this update: `afcedc2a9a8bd93c2dea4dc9f830e10f13bbb60f`; its workflow runs were queued/in progress at retrieval. No check is marked passed here.
- No Firestore rules or indexes were published by this work. No production Worker or web deployment was performed.
- Production build stamp and active web/Worker/rules rollback points: NOT RETRIEVED; verify from live deployment metadata before any production release.
- Approval gate: only `DEPLOY RULES) authorizes rules publication; Tier 1 or locked-behaviour PRs require `APPROVE <PR>` with a reason.