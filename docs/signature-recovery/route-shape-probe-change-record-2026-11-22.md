# Signature Recovery Route Shape Probe — Change Record

- **Change:** SR-2026-11-22-ROUTE-SHAPES
- **Instruction:** owner instruction, 2026-11-22.
- **Purpose:** Distinguish router matching from authentication and unknown-path fallback using unauthenticated GET requests only.
- **Baseline:** main at branch creation.
- **Probe target:** production Worker health host `https://irpa-google-drive-gateway.irpa-governance.workers.dev`.
- **Requests:** (1) evidence with synthetic envelope ID `ENV-0000000000000000`; (2) evidence with synthetic document-reference-shaped ID `IRPA-ENV-2026-00000000`; (3) the owner queue route `/api/recovery/envelopes?limit=50&offset=0`; (4) a nonsense control path.
- **Output:** HTTP status and first 100 response-body characters for each request. No bearer token, cookies, or other credentials are sent.
- **Safety:** GET only. Synthetic identifiers only. No envelope is read by an authenticated identity or modified. No signing, token, session, signer, field, stamping, PDF, hash, certificate, archive, Firestore rules, secret, environment, SMTP, or branch-protection changes.
- **Router contract reviewed:** `drive-gateway/src/router.mjs` evidence route matches GET paths using `^/api/recovery/envelopes/([A-Za-z0-9_-]{3,64})/evidence$`; screen uses `encodeURIComponent(item.envelopeId)`. The probe will determine whether the production Worker executes that router route or returns the unknown-path fallback.
- **Disposition:** no route implementation change is presumed until the real-format probe identifies a route mismatch. If both evidence requests return auth errors while the nonsense control returns 404 Not found, the route is live and matching; if evidence returns the same Not found fallback, investigate dispatch/deployed artifact rather than widening the ID pattern.
- **Rollback:** revert this workflow and record; no production data rollback is applicable.
