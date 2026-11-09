# IRPA DBGS Meta OAuth — staging publishing acceptance

## Scope

The existing Meta integration is being extended from read-only account verification to **real staging publishing** for:
- Facebook Pages: text/link feed posts.
- Instagram Professional accounts linked to an eligible Facebook Page: organic image-feed posts.

This capability is limited to the isolated staging Worker and staging Firebase project. It does not authorize publication to IRPA's public production accounts. Use only IRPA-owned or explicitly authorized test Pages and Instagram Professional accounts.

The current adapter does not implement Facebook video/Reels, Instagram video/Reels/Stories, scheduled publication, comments, direct messages, analytics or ad operations. Those remain out of scope until separately implemented and accepted. A destination must also appear in the explicit staging allowlist; an account returned by `/me/accounts` is not automatically authorized for publishing.

## Environment isolation

The gateway rejects Meta OAuth and publishing unless all of the following are true:
- `IRPA_ENVIRONMENT=staging`
- `FIREBASE_PROJECT_ID=irpa-dbg-staging-a73ec`
- `IRPA_PRODUCTION_CUTOVER=false`
- The callback is served on the exact staging gateway host.
- The existing staging `DRIVE_KV` binding is present.
- The staging token-encryption key decodes to exactly 32 bytes.

The production Worker remains on its production Firebase project and does not receive staging Meta credentials. No production publishing is implemented by this change.

## Required Meta permissions

The Facebook Login OAuth flow requests only the permissions needed for the supported publishing formats:
- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`
- `instagram_basic`
- `instagram_content_publish`

Meta may require app review / Advanced Access before accounts outside the app's authorized roles can grant these permissions. Do not request broader permissions such as messaging, insights or business-management access unless a later approved feature needs them.

Facebook Page publishing requires a Page content-management task: `CREATE_CONTENT`, `MANAGE`, `PROFILE_PLUS_CREATE_CONTENT` or `PROFILE_PLUS_FULL_CONTROL`, depending on the Page experience and Graph API response. Instagram publishing requires a Professional account linked to the selected Facebook Page and a publicly accessible HTTPS image URL. The current Instagram adapter publishes feed images only.

## Staging configuration

Worker variables:
- `META_APP_ID`: IRPA-approved Meta developer app ID.
- `META_GRAPH_API_VERSION`: pinned in staging Wrangler configuration to `v26.0`.
- `META_REDIRECT_URI`: `https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev/api/communications/meta/callback`.

Staging Worker secrets:
- `META_APP_SECRET`
- `META_TOKEN_ENCRYPTION_KEY`: separately generated random 32-byte key encoded as Base64.

For automated staging deployment, use GitHub repository variable `STAGING_META_APP_ID` and GitHub Actions secrets `STAGING_META_APP_SECRET` plus `STAGING_META_TOKEN_ENCRYPTION_KEY`. Also set GitHub repository variables `STAGING_META_ALLOWED_PAGE_IDS` and `STAGING_META_ALLOWED_INSTAGRAM_IDS` to comma-separated numeric IDs for authorized test destinations only. The workflow maps them to `META_STAGING_ALLOWED_PAGE_IDS` and `META_STAGING_ALLOWED_INSTAGRAM_IDS` on the staging Worker. If either allowlist is empty, account connection can be verified but all publishing attempts are rejected. Never include IRPA public production Page or Instagram IDs in these staging allowlists. The workflow validates configuration shape and provisions only the staging Worker. It must never print secret values or copy production credentials into staging. The frontend feature flag must read the App ID from the repository variable, not from a secret.

## Token custody

OAuth user and Page access tokens are encrypted with AES-256-GCM and stored only in the existing staging `DRIVE_KV` namespace. The browser receives account IDs, names, connection state and publishing outcomes only; it never receives tokens. Publishing requests use server-side bearer authorization. OAuth state is one-use and expires after 10 minutes. Reconnecting replaces the prior staging connection; local disconnect removes the encrypted record but does not revoke the app inside Meta.

The previous read-only token namespace is not reused. Users must reconnect Meta to grant the publishing permissions and create a new encrypted publishing connection.

## Governance controls

- Publishing is globally paused by default.
- The Worker reads the saved editorial item from server-side KV; it does not trust client-supplied approval fields.
- The saved item must be in `Approved` state and its approval revision must match its current revision.
- An approved post can be sent only to a destination ID returned by the signed-in user's encrypted Meta connection.
- Every successful and failed publishing attempt is recorded in the staging publishing audit.
- The emergency pause is administrator-controlled and is audited.
- Independent review remains the intended operational rule. Because IRPA DBGS currently has only an administrator enrolled, staging supports an explicit, audited administrator self-approval override. It is accepted only on staging and cannot bypass the production independent-review rule.

## Required acceptance

1. Verify the staging Meta app, Facebook Login product and exact callback URI.
2. Add authorized IRPA test accounts and controlled test Pages / Instagram Professional accounts.
3. Grant the five permissions listed above; verify the Page `CREATE_CONTENT` or `MANAGE` task.
4. Run the Meta OAuth unit tests, Worker tests, portal tests, web build and staging gateway regression suite.
5. Complete a real staging OAuth connection and verify Page and linked Instagram account IDs are returned without tokens.
6. With global pause ON, verify publishing is rejected and no post is sent.
7. With an approved test item and pause OFF, publish a Facebook text/link test and an Instagram image test to authorized test destinations.
8. Verify each external post ID, destination, actor, item ID and timestamp appears in the staging publishing audit.
9. Verify a forged client-side approval object, stale approval revision, unconnected destination and production environment are rejected.
10. Verify disconnect removes the encrypted staging connection and no production Worker, Firebase project, rules or secrets were changed.

A successful local unit test is not proof of a live Meta post. Report live publishing as NOT VERIFIED until the real staging acceptance above has been completed.
