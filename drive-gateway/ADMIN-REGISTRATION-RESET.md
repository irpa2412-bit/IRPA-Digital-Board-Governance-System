# Administrator registration recovery (Cloudflare Worker)

The recovery endpoint is implemented by the IRPA Drive Gateway Worker. It does not use Firebase Functions `defineSecret()` or Google Secret Manager.

## Security controls

- Endpoint: `POST /api/admin-registration/reset`.
- Feature flag: `ADMIN_REGISTRATION_RESET_ENABLED`; production remains `false`, staging is configured `true`.
- Secret: `IRPA_RESET_DEVELOPER_SECRET`, stored as a Cloudflare Worker secret and sent only in the `X-IRPA-Reset-Secret` request header. The Worker validates it server-side using a constant-time comparison.
- Caller: a valid Firebase ID token for the designated recovery operator `irpa2412@gmail.com`, with `auth_time` no older than 10 minutes.
- Additional request controls: explicit confirmation, UUID v4 operation ID, meaningful reason, and rejection of self-reset.
- Firestore calls use the authenticated operator's Firebase ID token, not a privileged service-account token. Existing Firestore Security Rules remain authoritative; no rules are widened.
- The only profile mutation is `adminProfiles/{targetUid}.active = false`, and only if that field is currently true. The profile, other fields, and Firebase Auth account are retained.
- A deterministic audit record is atomically appended to `audit/admin-registration-reset-{operationId}`. It includes a SHA-256 event hash and acts as the idempotency record. Operation-ID reuse with different details fails closed.
- Meetings, membership, finance, signed PDFs, signature evidence, and existing audit records are not deleted or modified.
- Deployment does not execute a reset. Do not enable production for this rollout.

## Configure staging

From the repository root, run this command and enter a randomly generated 32-byte secret encoded as 64 hexadecimal characters when prompted:

```powershell
npx wrangler secret put IRPA_RESET_DEVELOPER_SECRET --env staging
```

Do not commit the value, put it in a public variable, embed it in the frontend, or send it in a URL or JSON body. Store it in an approved password manager.

After review and passing tests, deploy only the staging Worker:

```powershell
npx wrangler deploy --env staging
```

The existing staging Worker must have a valid Firebase project configuration and its current Firebase authentication integration must work. The endpoint relies on Firestore Security Rules for the operator's authorized writes. If the billing blocker disables Firestore API access itself, this endpoint cannot write to Firestore until that separate service restriction is resolved; it does not bypass billing.

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
