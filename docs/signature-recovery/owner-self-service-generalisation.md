# Owner self-service signature recovery — generalisation requirements

## Scope and release decomposition

This is the acceptance contract for generalising the owner recovery experience beyond the single diagnostic envelope. It is not evidence that the behaviours below are implemented. Each implementation PR must include its own protected Change Record, applicable repair-window approval, tests, and required checks. Do not mark a Change Record complete or deploy until the corresponding behaviour is verified.

### PR A — owner assessment and report

- Add a per-envelope **Check this document** action to the owner Envelopes view for every non-Completed envelope, including CompletionFailed, Sent, Opened, Signing, stalled states, and cases where one or more signer rows are Signed but the envelope is not Completed.
- An owner may assess only envelopes they created. An administrator may assess any envelope. The Gateway Worker must enforce this scope on every request: signed-out 401, authenticated non-owner 403. A client-side visibility check is not authorization.
- Assessment is read-only with respect to envelope, signer, field, token, hash, certificate, and archive records. Its HTTP method allowlist is GET only. Assessment/audit-read telemetry, if retained, must be explicitly separated from signing evidence and must not alter the envelope's signature/audit chain.
- Return a single sanitised assessment report with English and Kiswahili wording: What happened; What is fine; What needs fixing; What you can do now. Include envelope state and cause, audit-chain verification, source-document hash verification, every stamp's PASS/FAILED/MISSING/UNVERIFIABLE state and reason with page and field number, finalisation stage (PDF_BUILD, HASH, ARCHIVE, CERTIFICATE, DISTRIBUTION, or SEND) and safe error code.
- Never return or render tokens, signing URLs, signature images, or full addresses. Provide Copy report and plain-text download. Do not expose the watermarked preview as a signing/completion artifact; any preview reference must be clearly non-authoritative and must not expose a tokenised URL.
- Validate and sanitise the complete Worker response before rendering. Isolate the panel behind an error boundary; malformed or unexpected responses must not crash the host application.
- Show a health badge on each envelope row: Healthy, Needs attention, or Failed. Healthy envelopes have no recovery actions.

### PR B — health badges and administrator attention

- Derive the envelope badge from the same validated assessment contract; do not infer health from signer rows alone.
- Provide administrators an Attention list of Failed and Needs attention envelopes across owners, including owner identity, document title, age in EAT, failing stage, and a Run assessment action.
- Add weekly aggregate counts to the administrator dashboard. Avoid exposing tokens, links, signature images, or full addresses.

### PR C — guided, confirmed actions

- Offer only state-appropriate actions: Send new link for an unsigned signer; Retry finalisation only for CompletionFailed after both audit chain and source hash verify; Repair draft only for explicitly orphaned/unassigned fields, naming page and field number without guessing an assignment; otherwise Contact administrator.
- Each action is a separate, explicit owner-confirmed operation for one envelope. Explain the effect before confirmation.
- Before action, persist a backup of the envelope record in the Gateway's existing metadata store, excluding signature images and tokens. Preserve original signatures and all original audit events.
- After action, append a separate recovery-action audit event containing actor, timestamp, action, and result. On failure, make no state change and return a safe stage/error code.
- Support Undo for seven days only where the operation is safely reversible; restore from the backup without deleting original signature or audit evidence.
- Rate-limit actions per envelope (initial policy: at most three retries per rolling hour) and return remaining attempts.
- Retry finalisation must call the existing normal finalisation path only; it must refuse if the audit chain or source hash fails. Never set Completed directly. Completed may result only from normal finalisation after evidence verification.

## Required test contract

Add to the email-signing-contract suite and PR checks:

1. Owner A cannot assess or act on Owner B's envelope (403); an administrator can; signed-out requests return 401.
2. Assessment issues GET only and leaves envelope, signer, field, token, hash, certificate, archive, signature evidence, and signing audit records unchanged.
3. Each guided action creates a backup before execution, preserves original signatures/audit events, writes a separate action audit event, leaves state unchanged on failure, supports eligible undo, and enforces rate limits.
4. No route or code path sets envelope status to Completed directly.
5. Retry finalisation refuses when audit-chain or source-hash verification fails.
6. Fixtures cover CompletionFailed with all signers Signed, a missing stamp, orphaned fields, a dead link, and a healthy envelope (Healthy badge and no actions).
7. Malformed Worker responses are contained by the recovery panel's error boundary.
8. Seven-portal smoke tests and full regression pass.

## Non-change boundary

Do not modify signing rules, tokens, link format, sessions, signer identity, field assignment, stamping, PDF generation, hash logic, certificate logic, archive logic, Firestore rules, secrets, environment variables, SMTP settings, or branch protection. Do not force-complete an envelope. Do not mutate a real envelope while developing or testing; use isolated fixtures.

## Protection and verification

- The existing PR #895 approval and 72-hour repair window authorize only the previously declared Signature Portal scope. They do not automatically authorize new shared paths, another portal, or the wider owner/admin feature set.
- Before touching any newly protected portal path, establish the portal mapping and obtain a distinct valid repair window for that portal. If the repository protection model maps a shared path to multiple portals, do not bypass or weaken that guard; split or formally register the scope through the repository's established governance process.
- Every implementation PR must declare exact changed files and expected effects, baseline/rollback commits verified from production deployment evidence, actual baseline smoke and full-regression run IDs, and its own PR-head check evidence. Unknown evidence remains NOT RETRIEVED, never fabricated.
- Merge only through normal branch protection after all required checks, portal smoke tests, and full regression pass. Deploy only through the no-secret-sync Gateway workflow and the approved Firebase/Cloudflare frontend workflows. Verify the merged build stamp and live health gate before claiming production.
- Keep assessment/report, health/admin view, and guided actions in separate small PRs as above.
