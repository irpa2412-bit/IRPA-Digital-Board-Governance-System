# Signature Recovery Route Dispatch — Change Record

- **Change ID:** SR-2026-11-22-02
- **Owner instruction:** 2026-11-22; repair the Signature Recovery Assessment evidence route without modifying any envelope.
- **Portal and component:** Signature Recovery Assessment owner portal (`src/pages/SignatureRecoveryOwnerPanel.jsx`) and the Cloudflare Drive Gateway e-signature request dispatcher/router.
- **Repair window:** No time-limited repair window was specified for this route repair. The change is a bounded dispatch defect correction; it does not establish an expiry, access grant, or data-repair period.
- **Baseline:** `605cc913b442bc4e28716937a549aee1d6766cb8` (main, PR #900 merged).
- **Cause:** `drive-gateway/src/router.mjs` already defined a GET evidence route with an ID regex accepting 3–64 characters from `[A-Za-z0-9_-]`. However, `drive-gateway/src/index.js` only dispatched requests through `esignRoute` when a separate `isEsignPath` allowlist matched. That allowlist omitted `/api/recovery/envelopes`, so valid recovery requests fell through to the top-level 404 handler before reaching the router.
- **Exact files and effects:**
  1. `drive-gateway/src/esignPathPolicy.mjs` — new shared route matcher and e-signature dispatch allowlist, including recovery queue, evidence, preview and stamp-reassignment routes.
  2. `drive-gateway/src/index.js` — delegates top-level e-signature dispatch matching to the shared policy; removes the duplicated local allowlist.
  3. `drive-gateway/src/router.mjs` — delegates evidence-path matching to the shared GET matcher; preserves `requireUser` and the existing owner-only evidence authorization.
  4. `drive-gateway/tests/signature-recovery-route-dispatch.test.mjs` — route-ID, queue-to-screen URL, GET-only, malformed-path and dispatch regression tests; also enforces the six-file change boundary against the baseline.
  5. `tests/signature-workflow-policy.test.mjs` — updates the existing distribution-retry dispatch assertion to inspect the shared policy module.
  6. `docs/signature-recovery/route-dispatch-change-record-2026-11-22.md` — this audit record.
- **ID coverage:** `test-id`, `ENV-0000000000000000`, `IRPA-ENV-2026-00000000`, and `IRPA-ENV-2026-11501354`. The UI continues to send `item.envelopeId` with `encodeURIComponent`; it does not send title or document reference in place of the envelope ID.
- **Tests:** validate each ID shape against the actual shared route matcher; assert the panel's queue and evidence URL construction; verify GET-only matching, malformed-path rejection, and top-level dispatch.
- **Prohibited changes and test enforcement:** the route-dispatch regression test runs `git diff --name-only 605cc913b442bc4e28716937a549aee1d6766cb8 HEAD` and requires the exact six-file allowlist above. Any additional modified path—including signing rules, token/link/session/signature identity or field-assignment code, stamping/PDF/hash/certificate/archive code, Firestore rules, secrets, environment variables, SMTP settings, or branch-protection configuration—fails the test.
- **Data safety:** no production login, no production envelope access or mutation, and no recovery action. Test IDs are synthetic.
- **Required check evidence (commit `395a88998b0e9a457ed33013e21b033e94ba3904`):**
  - Security Baseline / `security-baseline`: run `45046874454`, PASS; 16:59:34–17:03:22 UTC (3m48s).
  - Firebase Functions Entrypoint Integrity / `integrity`: run `45046874469`, PASS; 16:59:34–17:02:17 UTC (2m43s).
  - Readability Release Gate / `Readability Checker and Independent Verifier`: run `45046874417`, PASS; 16:59:34–17:02:10 UTC (2m36s).
  - Additional route/auth regression suite: run `45046874379`, PASS; 637 passed, 0 failed, 1 skipped.
  - No listed required check waited more than 15 minutes; no stale run was cancelled or rerun.
- **Deployment:** not performed by this change. After merge, use the existing no-secret-sync Worker workflow; verify the health build stamp and rerun the four unauthenticated route probes.
- **Rollback:** revert this focused dispatch-policy change to baseline `605cc913b442bc4e28716937a549aee1d6766cb8`.
