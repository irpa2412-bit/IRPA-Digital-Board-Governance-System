# Administrator registration recovery (Cloudflare Worker)

The recovery endpoint is implemented by the IRPA Drive Gateway Worker. It does not use Firebase Functions `defineSecret()` or Google Secret Manager.

## Security controls

- Endpoint: `POST /api/admin-registration/reset`.
- Feature flag: `ADMIN_REGISTRATION_RESET_ENABLED`. It is absent from the checked-in Wrangler configuration and production configuration. During the explicitly authorized staging-verification workflow only, CI generates an isolated staging Worker configuration with this flag set to true; do not add the flag to production or the checked-in Wrangler configuration. After verification, disable the flag on staging until another controlled test is authorized.
- Secret: `IRPA_RESET_DEVELOPER_SECRET`, stored as a Cloudflare Worker secret and sent only in the `X-IRPA-Reset-Secret` request header. The authorized CI workflow sources it from the repository Actions secret STAGING_IRPA_RESET_DEVELOPER_SECRET and injects it into the staging Worker without printing the value. The Worker validates it server-side using a constant-time comparison.
- Caller: a valid Firebase ID token for the designated recovery operator `irpa2412@gmail.com`, with `auth_time` no older than 10 minutes.
- Additional request controls: explicit confirmation, UUID v4 operation ID, meaningful reason, and rejection of self-reset.
- Firestore calls use the authenticated operator's Firebase ID token, not a privileged service-account token. Existing Firestore Security Rules remain authoritative; no rules are widened.
- The only profile mutation is `adminProfiles/{targetUid}.active = false`, and only if that field is currently true. The profile, other fields, and Firebase Auth account are retained.
- A deterministic audit record is atomically appended to `audit/admin-registration-reset-{operationId}`. It includes a SHA-256 event hash and acts as the idempotency record. Operation-ID reuse with different details fails closed.
- Meetings, membership, finance, signed PDFs, signature evidence, and existing audit records are not deleted or modified.
- Deployment does not execute a reset. Do not enable production for this rollout.

## Staging rollout and verification

Do not install Wrangler or configure secrets from a laptop. The authorized staging workflow requires `STAGING_IRPA_RESET_DEVELOPER_SECRET` to exist in GitHub Actions repository secrets. Store a newly generated 32-byte secret encoded as exactly 64 hexadecimal characters there, and let the workflow inject it directly into the dedicated staging Worker. Never place the value in source code, logs, a public variable, a URL, or this chat.

The workflow temporarily sets `ADMIN_REGISTRATION_RESET_ENABLED=true` in its generated staging-only configuration while the explicitly authorized staging verification runs. The checked-in Wrangler configuration and production configuration remain disabled. After verification, disable the feature on staging until another controlled test is authorized.

Before any operational reset, isolated tests and staging checks must verify wrong-secret rejection, non-operator rejection, stale-auth rejection, self-reset rejection, one-profile-only mutation, idempotency, and audit hash integrity.

The secret configuration does not itself prove that the Worker version is deployed or that Firestore writes succeed. Verify the active staging version and Firebase/Firestore availability separately. If billing restrictions disable Firestore API access, this endpoint cannot bypass that restriction.

## Secure staging-only operator test interface

- Page: `/admin-registration-reset-staging-test` on the dedicated staging Worker only.
- Invocation endpoint: `POST /api/admin-registration/reset-staging-test`.
- The page signs the designated operator in directly with Firebase Authentication using in-memory persistence, obtains a fresh Firebase ID token, and never stores or logs the password or ID token.
- The browser never receives or sends `IRPA_RESET_DEVELOPER_SECRET`. The staging Worker adds that secret to an internal request only after validating the exact staging environment, exact staging Firebase project, feature flag, and fixed staging test UID.
- The proxy rejects client-supplied `X-IRPA-Reset-Secret` headers and refuses any target UID other than the fixed dedicated staging test account. The shared recovery handler still enforces operator email, fresh `auth_time`, explicit confirmation, operation UUID, reason, and Firestore authorization.
- The staging page requires an explicit checkbox and exact confirmation phrase before the first destructive test request. It keeps the operation ID and payload in memory so the same operation can be replayed to verify idempotency. The page is no-store, no-referrer, frame-denied, and served with a restrictive Content Security Policy.
- The page and proxy return 404 unless `IRPA_ENVIRONMENT=staging`, `FIREBASE_PROJECT_ID=irpa-dbg-staging-a73ec`, `ADMIN_REGISTRATION_RESET_ENABLED=true`, and the staging test UID matches the compiled test fixture UID. The production Worker configuration must not set these staging values.
- This interface is for the dedicated staging test account only. Do not use it for operational administrator recovery or a production account.

## Request contract

Headers:
- `Authorization: Bearer <Firebase ID token>`
- `X-IRPA-Reset-Secret: <64-character hex secret>`
- `Content-Type: application/json`

JSON fields:
- `targetUid`: target administrator profile UID, not the operator UID.
- `operationId`: a fresh UUID v4 for this operation.
- `confirmation`: exactly `RESET ADMIN REGISTRATION ONLY`.
- `reason`: 20–500 characters explaining the verified recovery need.

Verify wrong-secret rejection, non-operator rejection, stale-auth rejection, self-reset rejection, one-profile-only mutation, repeated-request idempotency, and audit hash integrity in isolated staging before any operational recovery.
