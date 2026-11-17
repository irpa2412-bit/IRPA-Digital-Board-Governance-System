# Email-verified owner-defined signing routing

Implementation scope for this pull request:

- Replace matrix/register authority gates with email-code-verified signer identity, required declared name, and optional title.
- Implement owner-defined numeric routing positions, including parallel signers at the same position.
- Release later invitations only after every signer at the previous position signs; block early link use with a neutral not-your-turn response.
- Support owner email changes before opening, signer replacement, resend, one-per-hour reminders, audited void, signer decline, and status visibility.
- Complete only after every required final-position signer signs; verify final PDF, hash, and audit chain; distribute the PDF and ordered certificate; archive the completed document.
- Treat attendance-sheet attachments as optional, stored and hashed, never a send/completion gate.
- Replace matrix-gating tests with strict tests for the new behaviour and add stage-by-stage staging acceptance.

Guardrails: no Firestore rules, indexes, secrets, production signing feature-flag, or existing live signing-record changes. GitHub Actions is the test authority; no local test execution.
