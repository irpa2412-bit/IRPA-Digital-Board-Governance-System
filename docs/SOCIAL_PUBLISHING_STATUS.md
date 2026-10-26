# Social publishing implementation status

The portal must distinguish account inventory from a real OAuth connection. A record in `socialMediaAccounts` is not proof of a connected account, and a configured secret is not proof that an API call can publish.

## Safe foundation in this change

- Exposes authenticated Worker status and manual-export routes.
- Reports exact missing secret *names* only; never returns secret values.
- Uses platform-specific text limits for Facebook Pages, Instagram, LinkedIn, X, YouTube and WhatsApp.
- Defaults the global publishing pause to ON when the KV key is absent.
- Refuses publication unless the content is approved and contains approver identity and approval timestamp.
- Explicitly reports automatic adapters as FAIL until each real OAuth, token storage/refresh, media upload, publish API and live verification pathway is implemented.

## Required Worker secrets (names only)

- Meta/Facebook Pages and Instagram: `META_APP_ID`, `META_APP_SECRET`, `META_TOKEN_ENCRYPTION_KEY`.
- LinkedIn: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`.
- X: `X_CLIENT_ID`, `X_CLIENT_SECRET`.
- YouTube: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`.
- WhatsApp Cloud API: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`.

Credentials alone do not complete authorization. Platform-specific app review, scopes, page/channel permissions, redirect URIs, encrypted token persistence and refresh handling are still required. WhatsApp is a messaging API, not a general public-posting feed. YouTube requires resumable video upload and OAuth consent. Those routes must not be marked connected until end-to-end API checks pass.

## Routes

- `GET /api/communications/social/status`: adapter status and self-test; authenticated.
- `POST /api/communications/social/export`: returns a platform-formatted manual export; does not publish.
- `POST /api/communications/social/publish`: approval and pause gate, then fails closed while the adapter is not implemented.

Scheduling and Cron delivery are intentionally not represented as complete by this foundation. Do not enable automated publishing until the provider adapters, durable schedule queue, retry/idempotency policy, audit log, and pause-switch authorization have all passed staging tests.
