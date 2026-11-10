# Firestore rules approval

## Purpose

Changes to `firestore.rules` can alter production data access. The `firestore-rules-approval` check is a merge gate; it does not deploy rules itself. Production deployment workflows can publish Firestore rules when a qualifying change reaches `main`.

## What the check verifies

- If `firestore.rules` is unchanged in the pull request, the check passes without a label.
- If it changes, the repository must contain the `firestore-rules-approved` label.
- The check reads the PR's issue-event history and accepts only the latest label-application event when its actor is listed in `.github/firestore-rules-approvers.txt`. The repository owner `irpa2412-bit` is the sole initial approver.
- It verifies the label event happened after the latest rules-changing commit using GitHub's server-recorded PR timeline commit events. Missing or incomplete history is an error and fails closed.
- Removing the label invalidates approval. A later rules-changing commit makes the earlier label stale; the owner must remove and re-apply the label after reviewing the new diff.
- API errors, pagination errors, incomplete commit history and unexpected response shapes fail closed.
- On failure, the workflow updates one marked PR comment with the required explanation and a link to the PR files/diff.

The label is the only approval signal used by this check. A label applied by a bot, automation identity or other non-allow-listed actor does not satisfy it.

## How the owner reviews and approves

1. Open the PR and select **Files changed**.
2. Review the complete `firestore.rules` diff, including affected collections, read/write access, field allowlists, role checks and delete rules.
3. Confirm the change is intended and that tests cover permitted and denied access.
4. Only after review, apply `firestore-rules-approved` to the PR while signed in as the authorized owner account.
5. If the label is removed or a later commit changes `firestore.rules`, review the new diff and apply the label again. An earlier approval is not current.

GitHub does not offer per-label permissions. The workflow's event-actor check is the enforcement control; repository permissions should still be restricted to trusted maintainers.

## Merge and deployment

Merging a PR that changes `firestore.rules` to `main` can trigger production Firebase deployment workflows. The protected `production` Environment must have required reviewers configured so a merge alone cannot release production rules. The approval check is separate from Environment approval.

## Tests

Run the offline fixture suite with:

```sh
node --test tests/firestore-rules-approval.test.mjs
```

The fixtures cover unchanged rules, missing label, authorized owner label after the rules commit, unauthorized actor, stale approval and API error. They exercise pure decision logic; they do not simulate GitHub's live API or Actions event delivery.
