# IRPA Google Drive Gateway

This is the no-Firebase-billing document gateway for the IRPA Digital Board Governance System.

## Architecture

- Firebase Authentication remains the application identity provider.
- Firestore remains the governance metadata and authorization database.
- Google Drive under `irpa2412@gmail.com` is the document store.
- Cloudflare Workers provides the secure server-side Google OAuth/Drive gateway.
- Cloudflare Workers Free and Workers KV Free are sufficient for the intended pilot volume; current published limits are 100,000 Worker requests/day and 1,000 KV writes/day. 
- No Firebase Cloud Functions or Firebase Secret Manager is required for Google Drive.

## Endpoints

- `GET /health`
- `POST /oauth/start` — administrator only; requires a Firebase ID token.
- `GET /oauth/callback` — Google OAuth callback.
- `POST /api/upload` — authenticated PDF upload.
- `POST /api/download` — authenticated PDF download.

## Secrets

Set these in Cloudflare Worker Secrets:

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY`

The refresh token is encrypted with AES-256-GCM before being stored in Workers KV.

## Deployment

1. Create a Workers KV namespace.
2. Put its namespace ID into `wrangler.jsonc`.
3. Set the three secrets with Wrangler.
4. Deploy the Worker.
5. Add the deployed `/oauth/callback` URL as the Authorized redirect URI for the Google OAuth client.
6. Configure the web application with the Worker base URL as `VITE_GOOGLE_DRIVE_GATEWAY_URL`.

Do not commit secret values.


## Controlled invitation redemption migration

The Worker contains a controlled replacement for the Firebase Cloud Function
`redeemInvitationToken`. It is deliberately disabled in production and enabled
only in the staging Wrangler environment until a fresh invitation redemption
has passed.

The staged endpoint is:

`POST /api/invitations/redeem`

The migration preserves the existing Firebase Authentication accounts and UIDs,
the existing `invitations` Firestore records, the existing custom-token claims,
and the existing client-side `provisionCurrentMemberFromInvitationV2()` flow.
The original Firebase callable remains deployed as the rollback path.

### Credential boundary

The staging implementation uses the existing Firebase/GCP service-account
credential already held by GitHub as `GCP_SA_KEY`. The deployment workflow
copies that credential into the Cloudflare staging Worker secret
`FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON` without printing its value.

The credential is used only to obtain Google OAuth access for Identity Toolkit
user lookup/creation, Firestore redemption transactions, and local Firebase
custom-token signing. No credential is committed to the repository.

The production Worker has
`CLOUDFLARE_INVITATION_REDEMPTION_ENABLED = "false"`.
The staging Worker has it set to `"true"`.

Do not enable the production frontend flag or production Worker route until
staging has completed one fresh invitation redemption successfully.
