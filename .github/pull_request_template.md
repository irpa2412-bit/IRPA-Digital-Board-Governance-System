## Portal scope
- Affected portal (exactly one): 
- Per-portal repair window: `docs/portal-protection/windows/<portal-slug>.json`
- Per-portal Change Record: `docs/portal-protection/records/<portal-slug>.json`
- Lock tests: list the unchanged acceptance/lock tests that must pass.

## Guard-only light path
Select this only when the PR changes guard scripts, guard tests, portal register, per-portal windows/records, templates or protection documentation only. It must not change application runtime, Worker routes, signing, authentication, invitations, deletion logic, deployment workflows or Firestore rules.

## Cross-portal wiring
- Adapter-only boundary:
- Feature flag (default OFF):
- Kill switch:
- Confirm no working portal internals were changed:

## Required evidence
- Baseline smoke run:
- Portal lock-test run:
- Full regression run:
- Baseline commit:
- Rollback commit:
- Behaviour differences (or explicit none):

## Approval and window
- Owner approval command: `APPROVE <PR> <reason>` or `RENEW <portal> <reason>`
- Window duration: 72 hours; warning under 12 hours.
- Break-glass duration: 24 hours.
- Never record PASS manually. Link real GitHub Actions runs.
- Multi-portal PRs are blocked; split them into one-portal PRs.
