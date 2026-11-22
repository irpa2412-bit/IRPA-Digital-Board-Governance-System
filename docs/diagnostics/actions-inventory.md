# GitHub Actions workflow inventory

Baseline: `main` at `859e649da7e4661b61bee3da89d28578e3ee8843` (commit search result on 2026-11-03). Inventory covers the 57 workflow YAML files found under `.github/workflows/`.

**Important limits:** GitHub branch-protection required-check settings were not exposed by the available repository integration, so no workflow is labelled required or optional by guess. Check names must be preserved until repository administrators verify the protection configuration. Typical durations below are planning estimates based on job contents/runners, not measured historical medians; actual run-duration history was not retrievable for all workflows.

| Workflow file | Triggers observed on main | Jobs | Typical duration (estimate) | Required-check status |
|---|---|---|---:|---|
| android-apk.yml | PR + main push, path-filtered; dispatch | android | 8–18 min | Not retrieved |
| docs-validation.yml | PR + push for docs/srs; dispatch | validate-docs | 15–45 min | Not retrieved |
| build-desktop.yml | PR + main push, desktop paths | build-windows | 8–20 min | Not retrieved |
| build.yml | PR + main push; dispatch | build, windows-installer | 10–30 min | Not retrieved |
| gateway-deploy.yml | dispatch only | validate-gateway | 5–20 min | Not retrieved |
| offline-install-validation.yml | PR path-filtered | web-pwa | 4–12 min | Not retrieved |
| signature-palette-staging.yml | workflow_run after Signature Palette Visibility and Full Regression | deploy-staging | 5–20 min | Not retrieved |
| no-undef-sweep.yml | push on one feature branch; PR main; dispatch | undefined-name-gate, signature-source-integrity-tests | 3–15 min | Not retrieved |
| finance-production-reset.yml | dispatch only | reset | 1–5 min | Not retrieved |
| android-release-signed.yml | dispatch only (main-only job) | signed-apk | 10–25 min | Not retrieved |
| verify-livekit-staging.yml | dispatch only | verify-control-plane | 2–8 min | Not retrieved |
| deploy-grant-crawler.yml | main push, crawler paths; dispatch | deploy | 2–8 min | Not retrieved |
| firebase-cli-deploy.yml | main push; dispatch | build-and-deploy | 8–25 min | Not retrieved |
| staging-admin-reset-fixture.yml | dispatch only | seed-staging-admin-profile | 1–5 min | Not retrieved |
| portal-navigation-regression.yml | PR paths; push on named feature branch | portal-navigation-regression | 2–8 min | Not retrieved |
| cloudflare-livekit-secrets.yml | dispatch only | bind-secrets | 1–5 min | Not retrieved |
| production-browser-smoke.yml | main push; dispatch | browser-smoke | 5–15 min | Not retrieved |
| continuous-assessment-zip.yml | main push; dispatch | package-source | 1–3 min | Not retrieved |
| cloudflare-production-gateway.yml | dispatch only | deploy | 5–20 min | Not retrieved |
| meeting-invitation-flow-ci.yml | push on named feature branch, meeting paths | verify-meeting-invitation-flow | 3–12 min | Not retrieved |
| provision-meeting-archives.yml | main push on workflow-file change; dispatch | provision-and-verify | 2–8 min | Not retrieved |
| readability-release-gate.yml | PR + main push; dispatch | readability-and-contrast | 5–20 min | Not retrieved |
| deploy-livekit-staging.yml | push on two named branches; dispatch | deploy-media-server, deploy-staging-token-function | 10–30 min | Not retrieved |
| meeting-invitation-nonprod-e2e.yml | push on feature branch + PR main, meeting paths; dispatch | meeting-entry-emulator-e2e | 5–20 min | Not retrieved |
| cloudflare-gateway-deploy.yml | main push, drive-gateway paths; dispatch | deploy | 5–20 min | Not retrieved |
| firebase-hosting-mail-migration.yml | main push; dispatch | verify-cloudflare-frontend | 5–15 min | Not retrieved |
| grant-crawler-production.yml | main push, crawler-parallel paths | test, dashboard-build, deploy-production | 5–20 min | Not retrieved |
| meeting-invitation-staging-smtp-check.yml | dispatch only | staging-smtp-delivery | 2–8 min | Not retrieved |
| meeting-room-authorization-boundary.yml | push feature branch + PR main, meeting paths | verify-room-authorization-boundary | 2–8 min | Not retrieved |
| grant-crawler-parallel-ci.yml | PR paths | verify | 3–10 min | Not retrieved |
| cryptographic-gate.yml | push on signature feature branch, crypto paths; dispatch | cryptographic-gate | 3–12 min | Not retrieved |
| signature-pdf-page-diagnostics.yml | PR main; push on diagnostics branch; dispatch | pdf-page-diagnostics | 4–12 min | Not retrieved |
| firebase-deploy.yml | main push; dispatch | build-and-deploy, live-hosting-verification | 8–30 min | Not retrieved |
| cloudflare-pages-deploy.yml | main push on selected backend/rules paths; dispatch | build-and-deploy | 5–20 min | Not retrieved |
| diagnose-upload-cycle.yml | push on one diagnostic branch; dispatch | diagnose | 10–35 min | Not retrieved |
| cloudflare-interpreter-deploy.yml | main push, interpreter/meeting paths; dispatch | deploy-interpreter | 3–12 min | Not retrieved |
| upload-tdz-mainline-bisect.yml | PR paths; dispatch | prepare, bisect (matrix, max parallel 5) | 10–35 min | Not retrieved |
| grant-crawler-parallel-staging.yml | push main/feature + PR paths; dispatch | test, dashboard-build, firebase-rules-test, deploy-staging | 5–20 min | Not retrieved |
| meeting-media-governance.yml | PR paths; dispatch | meeting-media-governance | 3–12 min | Not retrieved |
| meeting-portal-fixture-browser.yml | push selected feature branches + PR main, broad meeting/signature paths | isolated-meeting-browser | 10–30 min | Not retrieved |
| signature-portal-forensic-repair.yml | push signature feature branch, gateway/signature paths; dispatch | forensic-repair | 5–20 min | Not retrieved |
| signature-realistic-last-page-fixtures.yml | PR diagnostics branch; push fixture branch; dispatch | realistic-last-page-acceptance | 5–20 min | Not retrieved |
| signature-palette-visibility.yml | PR main, signature paths; push named feature branch; dispatch | signature-regression | 5–20 min | Not retrieved |
| cloudflare-livekit-staging-frontend.yml | push on selected feature branches, frontend paths; dispatch | build-and-deploy-staging | 5–20 min | Not retrieved |
| meeting-room-ai-assistant-verification.yml | PR + main push, meeting assistant paths; dispatch | verify-meeting-room-assistant | 2–8 min | Not retrieved |
| staging-gateway-e2e.yml | push main + selected branches; PR main gateway/meeting paths; dispatch | local-e2e, repair-staging, acceptance-staging, preflight-staging, dispatch-staging-acceptance, deploy-staging, signature-acceptance, other-portals-report, deploy-staging-frontend | 15–60+ min | Not retrieved |
| production-promotion-gate.yml | PR main, application/backend/test paths | candidate-proof, gate-proof | 3–12 min | Not retrieved |
| dashboard-hero-check.yml | main push, dashboard/style paths | dashboard-hero-layout | 2–8 min | Not retrieved |
| dashboard-hero-pr-check.yml | PR paths | dashboard-hero-layout | 2–8 min | Not retrieved |
| grant-crawler-cloudflare-ci.yml | PR + main push, crawler paths | verify | 3–10 min | Not retrieved |
| fundraising-responsive-smoke.yml | PR paths; push named plan branch, fundraising paths | browser-smoke | 5–20 min | Not retrieved |
| firebase-free-governance-migration.yml | PR paths; push migration branch | build-and-regression | 5–20 min | Not retrieved |
| communications-website-integration.yml | push feature branch + PR main, communications paths | communications-integration | 5–20 min | Not retrieved |
| authenticated-governance-browser-fixture.yml | PR paths | authenticated-browser | 8–25 min | Not retrieved |
| document-lifecycle-module-test.yml | PR + push integration branches, document lifecycle paths | verify | 3–12 min | Not retrieved |
| signature-migration-build-test.yml | push feature branch; PR (unfiltered); dispatch | build, staging-isolation-preflight, deploy-cloudflare-staging | 5–25 min | Not retrieved |
| pdf-esignature-tests.yml | push selected branches + PR paths; dispatch | test | 3–15 min | Not retrieved |

## Queue-reduction observations

- Two independent Windows installer pipelines exist: `build.yml` and `build-desktop.yml`. The general `build.yml` also runs the Windows installer job without a path-specific condition.
- Android APK packaging is already path-filtered in `android-apk.yml`; the signed release APK is dispatch-only.
- `production-browser-smoke.yml` is main-push-only and runs one browser pass across two live frontends and six viewport widths.
- `diagnose-upload-cycle.yml`, `no-undef-sweep.yml`, and `upload-tdz-mainline-bisect.yml` are diagnostic/sweep workflows with push/PR triggers; these are candidates for dispatch-only execution.
- Some workflows already define concurrency; many PR/push workflows do not. Deploy workflows with existing `cancel-in-progress: false` serialization must retain it.
- Most workflows have no workflow-level docs-only path filter. A docs-only exclusion cannot safely be added at workflow level until required checks are known; a skipped workflow may leave a required check pending. Job-level gating with a stable always-run check is the safer approach.

## Required-check mapping and measured baseline

The available integration did not return branch protection / ruleset required-check configuration, nor complete historical workflow run durations. Therefore:
- **Required checks:** all entries remain **Not retrieved**; no check names should be removed or renamed.
- **Before runs/jobs/minutes per push:** not safely quantifiable from workflow definitions alone. Historical run counts and durations must be measured from Actions run history before/after.
- **After runs/jobs/minutes per push:** measure on the first comparable main push after this change; estimates in the table are not measured runtime data.
