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
