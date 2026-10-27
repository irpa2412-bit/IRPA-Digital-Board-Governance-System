# Editorial governance requirements (step 7)

Every public item must retain immutable audit events for draft creation, edits, submission, approval, return, scheduled publication, publication outcome, rollback, and archive. Each event records actor UID and role, timestamp, action, item ID, before/after revision identifiers, outcome and a redacted reason. Never store access tokens, application passwords, or secret values in item data or logs.

Roles:
- Administrator: configuration and emergency pause; cannot bypass the approval record.
- Communications Officer: author and editor; cannot approve own work.
- Approver: independently approves or returns content; approval requires actor, timestamp and revision ID.

A public publishing request must fail closed if any approval metadata is absent, the approval is for a different revision, the global pause is active, or the publishing feature flag is disabled. This document is a policy contract, not proof that every route is wired to enforce it.
