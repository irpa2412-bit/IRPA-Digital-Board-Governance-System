# Production release safeguards — proposed settings

Status: proposal only. This file does not apply GitHub repository or environment settings.

## 1. Protect `main`

Configure a branch ruleset targeting the default branch `main`:

- Enforcement: Active.
- Require a pull request before merging.
- Required approvals: 1.
- Require approval of the latest reviewable push.
- Dismiss stale approvals when new commits are pushed.
- Require review from Code Owners (`.github/CODEOWNERS`).
- Require all conversations to be resolved.
- Require all selected required status checks to pass before merging.
- Require branches to be up to date before merging.
- Block force pushes and branch deletion.
- Do not allow bypass for administrators or repository maintainers.
- Do not enable auto-merge.

Important identity limitation: GitHub does not allow a PR author to approve their own PR. The repository owner account `irpa2412-bit` is the current commit/PR author identity used by this workspace. To require the owner's approval of PRs created by another contributor, the owner must approve while signed into that owner account. PRs authored by that same account need a separate authorized reviewer; the author cannot self-approve.

## 2. Protect production environments

Configure required reviewers and prevent self-review on each environment used by a production deployment:

- `production` — Firebase Hosting/Firestore and Cloudflare frontend/gateway deployments.
- `irpa-grant-crawler-production` — isolated Grant Crawler deployment.

For each environment:
- Add the repository owner as a required reviewer.
- Enable prevent self-review.
- Disable administrator bypass where GitHub makes that control available.
- Restrict deployment branches to `main`.
- Keep environment secrets scoped to the existing environment; do not move or rename secrets as part of this proposal.

The workflows already reference `environment: production` for the main Firebase and Cloudflare deploy jobs. The Grant Crawler release uses `irpa-grant-crawler-production`; its existing environment name is preserved so its environment-scoped configuration is not silently changed.

## 3. Approval gate for Grant Crawler

The companion workflow change adds a separate job referencing `production` and makes the existing crawler deploy job depend on it. The crawler's own environment remains `irpa-grant-crawler-production`. This gives the crawler release a central production approval gate plus its existing environment gate.

## 4. Activation checklist

Do not activate settings until the owner confirms:

1. The account that must approve PRs and deployments.
2. The separate reviewer identity needed for PRs authored by `irpa2412-bit`.
3. Required status-check names after observing the current mainline CI.
4. Required reviewers and deployment branch restrictions for both environments.

No settings have been applied by this PR.
