# IRPA-DBGS protection roadmap — resumable status

Updated: 2026-11-21 (UTC)

| Stage | State | PR | Commit SHA | Run link | Next step |
|---|---|---|---|---|---|
| 0. Firestore publication safeguard | MERGED; PR diff contains no Firestore rules/index files. Merge commit has 17 successful, 10 skipped and 1 failed check; do not call the complete merge-commit suite green. | [#843](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/843) | `5fa8d46deeeb96c3172a1798411c18f57991855d` | [Checks](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/commit/5fa8d46deeeb96c3172a1798411c18f57991855d/checks) | Investigate the failed `build-and-regression` check; verify live deployment and rollback versions before marking release complete. |
| 0A. REAL/TRIAL deletion hotfix | OPEN; owner conditional approval recorded 2026-11-21; no merge/deploy. Latest PR head `9ea1160d3bb3293aa71d36a5edb1e0a7c2187a38`; signature regressions and meeting invitation flow pass, but build, signature regression (pre-#846 baseline assertions) and full regression checks are not all green. Baseline smoke PASS; full regression FAIL on exact base SHA. | [#845](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/845) | `9ea1160d3bb3293aa71d36a5edb1e0a7c2187a38` | [Checks](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/commit/9ea1160d3bb3293aa71d36a5edb1e0a7c2187a38/checks) | Repair the baseline full-regression assertion without weakening deployment approval; re-run baseline and final-head checks; merge/deploy only when every required check is green. |
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
- This is Tier 1 deletion protection. Owner's conditional approval is recorded in PR #845 comment 7068716176 and label `owner-approved`; the approval is not a waiver of checks.
- Environment classification is exact: only the literal `TRIAL` marker qualifies. Lowercase, whitespace-padded, missing or invalid values classify as REAL.
- The original shared `repair-window.json` and `change-record.json` history is preserved unchanged. New isolated records are `docs/portal-protection/records/meeting-portal.json` and `docs/portal-protection/windows/meeting-portal.json`.
- The original expired-window failure was traced to a 24-hour inactivity gap. That declaration was not bypassed; per-portal record selection and tests were added. Actual base-SHA evidence now exists: baseline smoke PASS and Meeting Portal smoke PASS; full regression FAIL due to a stale assertion in `tests/workflow-production-deploy-policy.test.mjs`.

## Release evidence and safety boundaries

- PR #843 merge SHA: `5fa8d46deeeb96c3172a1798411c18f57991855d`; its diff did not modify `firestore.rules` or `firestore.indexes.json`. This establishes no rules-file change in that PR, not a claim about unrelated deployments.
- PR #843 merge-commit checks: 17 success, 10 skipped, 1 failure (`build-and-regression`). Run/check evidence: [GitHub checks](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/commit/5fa8d46deeeb96c3172a1798411c18f57991855d/checks).
- PR #845 current head at this update: `9ea1160d3bb3293aa71d36a5edb1e0a7c2187a38`. Current checks include failures in build, signature regressions (the four baseline assertions addressed by PR #846), and full regression. The four targeted signature tests pass on PR #846; it is not yet green overall.
- Current failed policy run: [integrity job](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44947061426/job/136976578027).
- Baseline smoke evidence: [run 44948792716, job 136982110084](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44948792716/job/136982110084), checked out exact base SHA `5fa8d46deeeb96c3172a1798411c18f57991855d`; all seven registered portal suites passed, including Meeting Portal.
- Full regression evidence: [run 44948792716, job 136982110196](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/44948792716/job/136982110196), same exact base SHA; `npm run test:all` failed on `production Firebase CLI rules and Worker deployments require explicit owner dispatch approval` (8 pass, 1 fail). The assertion is stale against the exact `confirm_production_firestore_rules_deployment == 'DEPLOY'` workflow contract; test-only repair is tracked in [PR #850](https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/pull/850).
- No Firestore rules or indexes were published by this work. No production Worker or web deployment was performed.
- Production build stamp and active web/Worker/rules rollback points: NOT RETRIEVED; verify from live deployment metadata before any production release.
- Approval gate: only `DEPLOY RULES) authorizes rules publication; Tier 1 or locked-behaviour PRs require `APPROVE <PR>` with a reason.