# Signature Recovery Route Dispatch — Change Record

- **Change ID:** SR-2026-11-22-02
- **Owner instruction:** 2026-11-22; repair the Signature Recovery Assessment evidence route without modifying any envelope.
- **Baseline:** `605cc913b442bc4e28716937a549aee1d6766cb8` (main, PR #900 merged).
- **Cause:** `drive-gateway/src/router.mjs` already defined a GET evidence route with an ID regex accepting 3–64 characters from `[A-Za-z0-9_-]`. However, `drive-gateway/src/index.js` only dispatched requests through `esignRoute` when a separate `isEsignPath` allowlist matched. That allowlist omitted `/api/recovery/envelopes`, so valid recovery requests fell through to the top-level 404 handler before reaching the router.
- **Change:** add the recovery queue, evidence, preview and stamp-reassignment paths to the shared Worker dispatch policy; use a shared GET evidence matcher in the router; retain the existing `requireUser` and owner-only evidence authorization inside the evidence handler.
- **ID coverage:** `test-id`, `ENV-0000000000000000`, `IRPA-ENV-2026-00000000`, and `IRPA-ENV-2026-11501354`. The UI continues to send `item.envelopeId` with `encodeURIComponent`; it does not send title or document reference in place of the envelope ID.
- **Tests:** validate each ID shape against the actual shared route matcher; assert the panel's queue and evidence URL construction; verify GET-only matching, malformed-path rejection, and top-level dispatch.
- **Prohibited changes:** no signing rules, tokens, link format, sessions, signer identity, field assignment, stamping, PDF, hash, certificate, archive logic, Firestore rules, secrets, environment variables, SMTP settings, or branch protection changes.
- **Data safety:** no production login, no production envelope access or mutation, and no recovery action. Test IDs are synthetic.
- **Deployment:** not performed by this change. After required checks and merge, use the existing no-secret-sync Worker workflow; verify the health build stamp and rerun the four unauthenticated route probes.
- **Rollback:** revert this focused dispatch-policy change to baseline `605cc913b442bc4e28716937a549aee1d6766cb8`.
