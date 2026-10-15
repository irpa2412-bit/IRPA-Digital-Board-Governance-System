# Administrator registration recovery (Cloudflare Worker)

The recovery endpoint is implemented by the IRPA Drive Gateway Worker. It does not use Firebase Functions `defineSecret()` or Google Secret Manager.

## Security controls

- Endpoint: `POST /api/admin-registration/reset`.
- Feature flag: `ADMIN_REGISTRATION_RESET_ENABLED`. It is not enabled by the repository's Wrangler configuration. Keep it absent/false in production and staging until the staging verification phase is explicitly authorized; then set it only on the staging Worker through the Cloudflare Dashboard.
- Secret: `IRPA_RESET_DEVELOPER_SECRET`, stored as a Cloudflare Worker secret and sent only in the `X-IRPA-Reset-Secret` request header. The Worker validates it server-side using a constant-time comparison.
- Caller: a valid Firebase ID token for the designated recovery operator `irpa2412@gmail.com`, with `auth_time` no older than 10 minutes.
- Additional request controls: explicit confirmation, UUID v4 operation ID, meaningful reason, and rejection of self-reset.
- Firestore calls use the authenticated operator's Firebase ID token, not a privileged service-account token. Existing Firestore Security Rules remain authoritative; no rules are widened.
- The only profile mutation is `adminProfiles/{targetUid}.active = false`, and only if that field is currently true. The profile, other fields, and Firebase Auth account are retained.
- A deterministic audit record is atomically appended to `audit/admin-registration-reset-{operationId}`. It includes a SHA-256 event hash and acts as the idempotency record. Operation-ID reuse with different details fails closed.
- Meetings, membership, finance, signed PDFs, signature evidence, and existing audit records are not deleted or modified.
- Deployment does not execute a reset. Do not enable production for this rollout.

## Configure staging (browser-only)

Do not install Wrangler or configure the secret from a laptop. After the PR is reviewed and the staging phase is explicitly authorized:

1. Open the Cloudflare Dashboard and select **Workers & Pages**.
2. Open the existing staging Worker, `irpa-google-drive-gateway-staging`. Verify the Worker name before changing anything; do not select the production Worker.
3. Under **Settings → Variables and Secrets**, add a **Secret** named `IRPA_RESET_DEVELOPER_SECRET`. Use a newly generated 32-byte secret encoded as exactly 64 hexadecimal characters. Enter it directly in Cloudflare; never place it in GitHub, source code, a public variable, a URL, or this chat.
4. Keep `ADMIN_REGISTRATION_RESET_ENABLED` absent or set to `false` until the controlled staging verification is ready. Enable it only on staging for that verification. Production must remain disabled.
5. Do not perform a real administrator reset until the isolated tests and staging checks verify wrong-secret rejection, non-operator rejection, stale-auth rejection, self-reset rejection, one-profile-only mutation, idempotency, and audit hash integrity.

The secret configuration does not itself prove that the Worker version is deployed or that Firestore writes succeed. Verify the active staging version and Firebase/Firestore availability separately. If billing restrictions disable Firestore API access, this endpoint cannot bypass that restriction.

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
