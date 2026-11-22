# PR #895 verification snapshot — 2026-11-22 15:21 UTC

This is an evidence snapshot, not an approval to merge or deploy.

- PR: #895
- Branch: `feat/owner-signature-recovery-screen-20261122`
- Inspected head: `53855684a92eea1ebdf8e807b79350a34b031af0`
- Repair window: Signature Portal, opened `2026-11-22T15:05:20.559Z`, expires `2026-11-25T15:05:20.559Z`.

## Required checks

| Required check | Run | Result at inspection |
|---|---:|---|
| security-baseline | 45037793721 | FAIL — policy reports completed Change Record required |
| integrity | 45037793618 | FAIL — policy reports completed Change Record required |
| Readability Checker and Independent Verifier | 45037793726 | IN PROGRESS |
| email-signing-contract | 45037793673 | IN PROGRESS |

## Change Record evidence gap

The Change Record remains `incomplete`. The production deployment baseline commit is recorded as `25ddcc6d8f89b6a4103c37a254fbd2af0c26febe`, supported by Gateway deployment/health run 45024123456 and Firebase Hosting verification run 45024123411.

The protection script requires real GitHub Actions job-log URLs for all of:
- successful baseline smoke on that exact baseline commit;
- successful full regression on that exact baseline commit;
- successful Signature Portal smoke on that exact baseline commit.

Those three job-level evidence links and run IDs have not been retrieved and verified. The previously recorded successful frontend build runs for PR #895 are not substitutes for baseline smoke/full-regression evidence. Consequently, `baselineSmoke` and `fullRegression` remain NOT RETRIEVED, the Change Record must not be marked complete, and the protection gate must not be bypassed.

## Deployment

No merge or production deployment is authorised by this snapshot. Do not deploy an unmerged head. No production login or envelope mutation was attempted.

## Additional baseline runs retrieved

The main-branch run list for the exact baseline commit also confirms these successful supporting checks (all created 2026-11-22 around 12:47 UTC):

| Check | Run |
|---|---:|
| email-signing-contract | 45024123162 |
| Authentication and Identity Parity Tests | 45024123404 |
| Firebase Functions Entrypoint Integrity Test | 45024123437 |
| IRPA Security Baseline Gate | 45024123414 |
| IRPA-DBGS Readability Release Gate | 45024123170 |
| IRPA Release Build | 45024123168 |
| Firebase-free governance migration checks | 45024123423 |
| Cloudflare Gateway deployment (no secret sync) | 45024123456 |
| Firebase Hosting deploy/live verification | 45024123411 |

These successful runs strengthen the baseline evidence, but none is explicitly identified or independently verified as the required baseline smoke, full regression, or Signature Portal smoke job. They are therefore recorded as supporting evidence only and do not satisfy the guard's three distinct evidence labels.
