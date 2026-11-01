# IRPA Communication & Media Portal

## Purpose
An integrated communications workspace inside the existing IRPA Digital Board Governance System. It reuses the existing authenticated Cloudflare Drive Gateway, Firebase identity and Firestore audit pathways. It does not add a separate app or new storage provider.

## Included capabilities
- Website article, press-release and social-media draft creation.
- Content library, editorial planning calendar, review, approval, return-for-revision and archival workflow.
- Approved website publishing through the existing Cloudflare Worker.
- Read and update WordPress pages/posts through the WordPress REST API.
- cPanel connection verification and restricted static-file editing through cPanel UAPI.
- Multi-format media upload into the verified Google Drive `Communication and Media Archive` through the existing authenticated gateway, with Firestore metadata and role-based access. The archive is provisioned idempotently and the server verifies its folder marker before accepting media. Firebase Storage remains deny-by-default.
- Media library, authenticated download, image editing/export, audio/video preview and browser-native trim/export, within the existing gateway's file-size and format limits.


## Communication and Media Archive provisioning and recovery

- The authorised media upload flow provisions (or reuses and verifies) the dedicated `Communication and Media Archive` folder under the configured IRPA Drive root. Media binaries are stored in that folder; the Firestore `communicationMediaAssets` collection remains a metadata-only register.
- Provisioning and upload require the existing server-side communications role check. The gateway rejects arbitrary folder IDs and accepts only a folder marked as the IRPA Communication and Media Archive.
- If the gateway returns `GOOGLE_DRIVE_NOT_AUTHORIZED` (HTTP 503), the refresh-token record is absent from the configured Worker KV namespace. An active IRPA administrator must open the application's Settings and complete Google OAuth using the specifically authorised Google account. The callback verifies the account and encrypts the refresh token before saving it. Retry only after the callback confirms success; never paste tokens or encryption keys into logs or source control.
- Validate this change in the isolated staging environment only. Configure the staging app to use the staging gateway, Firebase project and dedicated staging KV namespace; do not copy production OAuth state, secrets or token records into staging. Verify the archive folder, upload response/file ID, Firestore register entry, role-denied behavior and audit coverage before considering acceptance.

## Communications operations registers

The Communications Operations workspace is available alongside the editorial workspace. It provides structured registers for:

- **Campaigns:** owner, dates, channels, target audience, objective and optional budget reference.
- **Media contacts:** journalist/contact details, organization, coverage beat and contact permission/basis. Store only professional contact details needed for legitimate communications.
- **Brand register:** approved asset links, custodian, version, attribution/usage rights and review date. Asset binaries remain on the existing authenticated Google Drive pathway; no new storage provider is introduced.
- **Crisis response:** severity, response lead, approving authority, activation trigger, draft holding statement and next review date. Do not store credentials, security secrets or unnecessary sensitive personal data.
- **Media coverage and metrics:** source URL, observation date, sourced reach/engagement, assessment and supporting evidence. These are manual records, not claims of automatic social-platform analytics.

Records are retained and archived rather than hard-deleted. Operations changes are committed together with an audit event using a Firestore batch. The dedicated `communicationOperations` collection has an explicit field allowlist and role-scoped create/read/update rules; `communicationOperationsAudit` is reviewer-readable and immutable after creation. A browser success message is shown only after the batch commits. If the batch fails, the interface reports failure and does not claim that the record or audit entry was saved.

The workspace intentionally does not auto-publish social posts, send messages to media contacts, infer analytics, or trigger crisis communications. Those integrations require separate authorized design and acceptance. It is intended to be usable for planning and record keeping while website integration is pending.

## Social-media account enrolment and management

The **Social Accounts** workspace registers IRPA-owned or IRPA-authorized social accounts in the existing portal. Supported platforms include Facebook, Instagram, LinkedIn, X, YouTube, TikTok, WhatsApp, Telegram and Other. Each entry can capture the public account/page name and handle, HTTPS public profile URL, account type, responsible officer, access custodian, purpose, target audience, internal authorization reference and next access-review date.

- New records start at **Pending Verification**; an authorized reviewer can mark them active, suspend them, mark them disconnected or archive them.
- Account details are editable by the enrolling officer while pending verification and by authorized reviewers under the Firestore policy. Status transitions are reviewer-controlled.
- Every enrolment, edit and status change is committed with an audit entry in the same Firestore batch. Audit entries are immutable; records are archived rather than hard-deleted.
- Firestore rules enforce field allowlists, HTTPS profile links, role checks, permitted status transitions and matching audit records. No credentials or API tokens are accepted in the schema.
- Use only accounts IRPA owns or has documented authorization to manage. Keep the custodian and authorization reference current, review access periodically, and use the platform's own security controls to remove former staff.

**Important boundary:** this is secure account inventory and governance, not a live platform connection. It does not perform OAuth authorization, store passwords/recovery codes/access tokens, publish or schedule posts, read private messages, retrieve live analytics, or revoke access on a social network. Status is a manually reviewed register state, not a claim that an API connection is working. Direct publishing or analytics would require a separate platform-by-platform integration with approved OAuth scopes, server-side token custody, revocation/expiry handling, consent, and independent security and staging acceptance. Do not put credentials in the account notes or profile URL.

## Website and cPanel access

WordPress page/post editing uses a dedicated WordPress account whose role is exactly `Editor`, with an application password and only the permissions needed to edit pages/posts. The Worker checks `/users/me` and refuses an account carrying the `administrator` role. Never use a personal or main administrator account/password. The gateway host guard is environment-specific and unchanged: the production Worker accepts only `irpa.or.tz` or `www.irpa.or.tz`; the staging Worker accepts only `staging.irpa.or.tz`. A production hostname with a `/staging` path is rejected. Website Studio saves edits as drafts; production publication remains reserved for the separate approved communications workflow.
The portal calls the existing Cloudflare Worker routes:
- `GET /api/communications/site/status` — verifies the configured WordPress connection without returning credentials.
- `GET /api/communications/website/content?type=posts|pages` — lists up to 50 pages or posts in the configured WordPress environment.
- `GET /api/communications/website/content/pages/{id}` or `/posts/{id}` — reads one item with edit-context fields.
- `POST /api/communications/website/content` — creates a new WordPress post with title, content, excerpt, featured image ID, existing category/tag IDs and supported Yoast metadata. The Worker hard-codes `status: draft`, verifies the returned post remains a draft, and audits creation; callers cannot supply a publish status.
- `PUT /api/communications/website/content` — updates title, content, excerpt, featured image ID, existing category/tag IDs and writable Yoast fields. Website Studio submits `draft`; the Worker rejects publish status in production.
- `GET /api/communications/website/terms` — reads existing WordPress categories/tags and reports Yoast meta fields writable through the WordPress REST schema. Yoast values are sent only when the REST `OPTIONS` schema exposes the matching writable property; otherwise no meta keys are guessed or written.
- `POST /api/communications/website/media` — accepts JPEG, PNG, WebP and GIF only; alt text is mandatory and caption optional. Default per-file limit is 5 MiB, configurable with the non-secret Worker variable `WORDPRESS_MEDIA_MAX_BYTES` up to an 8 MiB hard ceiling. The Worker checks filename extension and image signature, then verifies WordPress stored alt text.
- Website Studio supports sequential multi-image selection with per-file upload progress and error states. Video is link-only: YouTube/Vimeo URLs are accepted; video files are not uploaded to WordPress.
- `GET /api/communications/website/revisions?type=pages|posts&id={id}` — lists native WordPress revisions and complete pre-edit snapshots.
- `POST /api/communications/website/restore` — restores a saved snapshot or WordPress revision; a pre-restore snapshot is saved first.
- `POST /api/communications/website/publish` — retains the existing approved article/press-release workflow and deterministic-slug reconciliation.
- `GET /api/communications/cpanel/files` — lists permitted static files from the configured document root.
- `GET /api/communications/cpanel/files?path=<relative-path>` — reads a permitted static file.
- `PUT /api/communications/cpanel/files` — saves a permitted static file through cPanel UAPI after saving a seven-day snapshot in the existing Cloudflare KV namespace.
- `POST /api/communications/cpanel/rollback` — restores a matching snapshot and keeps the pre-rollback version for seven days.

The cPanel editor intentionally accepts only HTML, HTM, CSS, TXT and JSON files, with a 512 KiB limit. Before each write it reads the existing file and stores a seven-day rollback snapshot in the existing Cloudflare KV namespace; the editor exposes a rollback action and records audit events. It rejects path traversal, hidden paths, PHP and other executable/script extensions; it does not provide arbitrary shell access, delete-file operations, or unrestricted hosting administration. WordPress page/post content should be edited through the WordPress API. The portal does not embed a cPanel password login session in the browser; it authenticates server-to-server through a restricted cPanel API token.

## Required Cloudflare Worker secrets
Set these as Worker secrets in the correct environment; never commit them or paste them into the portal:
- `WORDPRESS_BASE_URL`: the HTTPS WordPress origin for the Worker environment, with no path, credentials, query or fragment. Staging accepts only `https://staging.irpa.or.tz`; production accepts only `https://irpa.or.tz` or `https://www.irpa.or.tz`. The gateway rejects a production hostname with a `/staging` path; do not bypass this guard.
- `WORDPRESS_USERNAME`: dedicated WordPress integration account.
- `WORDPRESS_APPLICATION_PASSWORD`: application password for that dedicated account.
- `CPANEL_BASE_URL`: HTTPS cPanel hostname with port 2083, for example the actual hosting provider hostname; do not guess the host.
- `CPANEL_USERNAME`: the cPanel account username.
- `CPANEL_API_TOKEN`: a cPanel API token with only the required account-level permissions.
- `CPANEL_DOCUMENT_ROOT` (optional non-secret Worker variable): document-root-relative directory, default `public_html`.

Use the Cloudflare dashboard or Wrangler's interactive secret prompt for the intended environment. Example commands (run only in the repository's authorised Cloudflare environment):
```sh
npx wrangler secret put WORDPRESS_BASE_URL
npx wrangler secret put WORDPRESS_USERNAME
npx wrangler secret put WORDPRESS_APPLICATION_PASSWORD
npx wrangler secret put CPANEL_BASE_URL
npx wrangler secret put CPANEL_USERNAME
npx wrangler secret put CPANEL_API_TOKEN
```
For staging, explicitly target the staging Worker environment using the supported Wrangler `--env staging` option. Do not copy production credentials into staging. Do not log or print secret values.

Production deployment is gated on six GitHub Actions secrets being configured for the production workflow: `PRODUCTION_WORDPRESS_BASE_URL`, `PRODUCTION_WORDPRESS_USERNAME`, `PRODUCTION_WORDPRESS_APPLICATION_PASSWORD`, `PRODUCTION_CPANEL_BASE_URL`, `PRODUCTION_CPANEL_USERNAME`, and `PRODUCTION_CPANEL_API_TOKEN`. The production workflow validates their presence and endpoint formats before changing the Worker, then transfers the values into Cloudflare Worker secrets without printing them. Do not put these values in source control or paste them into chat.

## Automated staging acceptance prerequisites

The staging workflow runs on the Communication & Media integration pull request and deploys only the dedicated `irpa-google-drive-gateway-staging` Worker. It requires the following repository Actions secrets; values are never printed by the workflow:

- Existing isolated staging infrastructure: `STAGING_CLOUDFLARE_API_TOKEN`, `STAGING_CLOUDFLARE_ACCOUNT_ID`, `STAGING_FIREBASE_PROJECT_ID`, `STAGING_IRPA_APP_URL`, `STAGING_GOOGLE_DRIVE_CLIENT_ID`, `STAGING_GOOGLE_DRIVE_CLIENT_SECRET`, `STAGING_GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY`, `STAGING_SMTP_PASSWORD`. The Cloudflare token must be staging-specific and must not have production deployment permissions.
- Isolated staging Firebase: `STAGING_FIREBASE_SERVICE_ACCOUNT_JSON`, `STAGING_FIREBASE_WEB_API_KEY`, `STAGING_TEST_EMAIL`, `STAGING_TEST_PASSWORD`. The service account project ID must exactly match the staging Firebase project ID, which must not be the production project.
- Isolated staging WordPress: `STAGING_WORDPRESS_BASE_URL` only. Do not create GitHub Actions secrets for the WordPress username or application password. Configure `WORDPRESS_USERNAME` and `WORDPRESS_APPLICATION_PASSWORD` directly in the dedicated staging Worker secrets in Cloudflare; the workflow does not read or transmit those credential values.
- Isolated staging cPanel account: `STAGING_CPANEL_BASE_URL`, `STAGING_CPANEL_USERNAME`, `STAGING_CPANEL_API_TOKEN`, `STAGING_CPANEL_DOCUMENT_ROOT`, `STAGING_CPANEL_TEST_FILE`. The test-file secret must be a safe relative `.txt` filename within the isolated staging document root.

Before any staging WordPress file or page write, configure protected Actions secrets `STAGING_WORDPRESS_DB_NAME` and `PRODUCTION_WORDPRESS_DB_NAME` with the respective database names; the workflow compares them against the staging `wp-config.php` mapping without printing either value and aborts if isolation is not verified. The workflow requires exactly one pre-provisioned staging page titled `IRPA Staging Integration Check`; it discovers the page through the Worker API, then reads, edits, verifies and restores it without direct WordPress credentials. It also requires Actions variables `STAGING_SMTP_HOST`, `STAGING_SMTP_PORT` (`465` or `587`), and `STAGING_SMTP_FROM`. Staging SMTP host/sender must not be `mail.irpa.or.tz` / `info@irpa.or.tz`; production mail configuration is rejected. The workflow verifies the explicit staging health marker, authenticates a staging reviewer, checks both server-side connections, updates a dedicated staging WordPress test page and verifies its public rendering before restoring the prior state, edits a staging cPanel test file and exercises its seven-day rollback, then verifies path-traversal/executable-path rejection. Missing staging secrets or failed acceptance block release; production credentials must never be substituted. See [COMMUNICATION_MEDIA_READINESS_CHECKLIST.md](COMMUNICATION_MEDIA_READINESS_CHECKLIST.md) for the full configuration checklist.

## Authorization and audit
- Every website and cPanel route verifies the Firebase ID token at the Cloudflare Worker.
- WordPress page/post edits and restores require an active registered Communication & Media role or an active administrator profile; broader reviewer roles alone are insufficient. The cPanel static-file editor retains its separate reviewer gate. Credentials stay server-side.
- Website publishing is limited to approved website articles and press releases.
- Before every page/post edit or restore, the Worker saves a complete pre-edit snapshot in the staging Worker KV namespace, records the current WordPress revision ID, and writes an audit event with actor, action, timestamp and page/post ID. The update is then verified by re-reading the item; the saved snapshot appears in revision history and can be restored with one click. Audit entries contain no WordPress credentials or content secrets.
- cPanel writes are restricted to static content file types and record an audit event.
- No Firebase Functions callable is required for website publishing, avoiding a new Cloud Functions billing dependency.

## Acceptance and release gates
1. Run `npm run test:communication-media`, the full required test suite, production build, gateway syntax/security tests and browser regression checks.
2. Verify role-denial behavior for unauthenticated and non-reviewer users.
3. Verify the staging WordPress `users/me` status code is 200, list and read a test page/post, edit only allowlisted fields, verify the edit, and restore the saved snapshot exactly. Verify a non-Communication & Media user is refused. Check logs and audit events for secrets. Also verify approved publishing, failure handling and duplicate reconciliation against isolated staging WordPress.
4. Verify cPanel token authentication, permitted file listing/read/write, path traversal rejection, executable-file rejection and audit evidence against isolated staging hosting.
5. Confirm the public page after a staged edit and verify the previous content is preserved for rollback.
6. Verify desktop and mobile portal usability and ensure unrelated governance portals retain existing behavior.
7. Merge only after all required checks pass; deploy and live-verify only after staging acceptance. Do not claim live integration until the secret-backed connection checks and actual test writes succeed.

Production secrets and deployments must not be changed merely by merging this code.

## Supported document and media upload formats

The Media Asset Studio uploads through the authenticated Google Drive gateway; it does not write to Firebase Storage. Each generic archive upload is limited to 25 MiB by the current browser route. Website Studio WordPress article images use a separate 5 MiB default per-file limit. The selector advertises these formats:

- **Office documents:** PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, RTF, ODT, ODS, ODP.
- **Structured and text content:** TXT, CSV, TSV, Markdown (MD), HTML, JSON, XML, EPUB, ZIP.
- **Images:** JPG/JPEG, PNG, WEBP, SVG, GIF, BMP, TIF/TIFF, AVIF.
- **Audio:** MP3, WAV, M4A, AAC, OGG, FLAC.
- **Video:** MP4, WEBM, MOV, AVI, MKV.

This is the supported list, not a claim that every proprietary, encrypted, damaged, or future file format is supported. MIME type is checked against the allowlist; unknown types are rejected. Files are stored as originals in the existing Drive pathway and registered as metadata in Firestore. Authenticated download is by Drive file ID. Image adjustments and browser-native audio/video trimming export a new local derivative and never overwrite the original. The generic Communication Media Asset Studio accepts one file per submission. Website Studio accepts a multi-image selection and uploads each image sequentially, reporting progress and errors per file. Website Studio does not upload video files; it accepts YouTube/Vimeo links only.

## Live website editor and preview

The Publishing Setup workspace loads existing WordPress pages or posts, lets an authorised reviewer edit the title and content, and saves through the authenticated Cloudflare Worker. It also offers a “New update” action that creates a post as a draft only. The editor provides an **unsaved, sandboxed live preview** that updates from the current form contents when preview is open. The preview iframe has an empty sandbox (no script execution), sends no referrer, and is explicitly a visual approximation rather than the live theme. It does not publish or save content by opening preview.

The server-side editor enforces Firebase authentication, active registered reviewer roles, HTTPS WordPress configuration, a 30,000-character content limit, allowlisted HTML tags/attributes and URL schemes, and audit recording. Saving is an immediate live WordPress write; the interface requires an explicit confirmation before the write. Review the preview, confirm the target page/post and keep a copy of the prior content before saving. Confirm the returned public URL after the write. If the WordPress or cPanel connection is not configured and verified, the portal must show the connection failure rather than simulate a successful edit.

The cPanel file editor is deliberately separate and restricted to existing static HTML/HTM, CSS, TXT and JSON files (512 KiB maximum). It does not edit PHP, run commands, create arbitrary files, or provide hosting administration. WordPress page/post editing should be preferred for content managed by WordPress. Secrets remain in the server-side Worker environment, never in the browser bundle or Firestore.

## Meta (Facebook and Instagram) API — staging-only connection and access verification

The initial Meta integration uses the existing Cloudflare gateway and its isolated `staging` environment. It does not add a second gateway, Firebase Functions, a new storage service, or a browser-held Meta token.

- OAuth routes: `POST /api/communications/meta/connect`, `GET /api/communications/meta/callback`, and `GET /api/communications/meta/status`.
- The callback is fixed to `https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev/api/communications/meta/callback`. Register this exact URI in the Meta developer app. The router checks the exact callback URI, `IRPA_ENVIRONMENT=staging`, Firebase project `irpa-dbg-staging-a73ec`, and `IRPA_PRODUCTION_CUTOVER=false` before accepting a request.
- The gateway authenticates the Firebase user and requires an active IRPA account with a communications/reviewer role or an active administrator profile before starting OAuth or reading connection status.
- Requested permissions are limited to `pages_show_list`, `pages_read_engagement`, and `instagram_basic`. Publishing, messaging, comments management, ads, and insights permissions are intentionally not requested.
- The callback consumes a single-use, 10-minute OAuth state from the existing staging `DRIVE_KV`, exchanges the code server-side, attempts a long-lived-token exchange, and checks `/me`, `/me/permissions`, and managed Pages plus linked Instagram professional accounts. It does not request or return Page access tokens. Requests lacking any required read-only scope fail verification and the token is not persisted.
- The Meta user token is encrypted server-side with AES-GCM using a dedicated 32-byte `META_TOKEN_ENCRYPTION_KEY` secret and stored only in the existing staging `DRIVE_KV`. It is never returned to the browser, written to Firestore, or committed to source control. Do not reuse the Google Drive encryption key.
- The status response contains only account metadata, requested scope names, token expiry/connection timestamps, and `postingEnabled: false`. The backend re-checks the granted scopes on each verification. A Facebook Page without a linked Instagram professional account is not reported as an Instagram connection.
- `POST /api/communications/meta/disconnect` removes the local encrypted staging token; it does not revoke authorization inside Meta, which must be revoked separately in Meta settings if required. There is no social publishing route in this initial integration. Social posting remains disabled regardless of connection status.

### Staging Meta configuration

1. Create or select IRPA's Meta developer app and configure Facebook Login for Web. Use an app with the least privilege needed for managed Facebook Pages and linked Instagram professional accounts. Add the exact callback URI above under valid OAuth redirect URIs.
2. Set the GitHub repository variable `STAGING_META_APP_ID` to the Meta app ID (non-secret). The staging workflow maps it to the Worker variable `META_APP_ID`; it also sets `META_GRAPH_API_VERSION=v26.0` and the fixed `META_REDIRECT_URI` in the generated staging Worker configuration. Do not put values in source files.
3. Add GitHub Actions secrets `STAGING_META_APP_SECRET` and `STAGING_META_TOKEN_ENCRYPTION_KEY`. The staging workflow injects these as Worker secrets `META_APP_SECRET` and `META_TOKEN_ENCRYPTION_KEY` only. The encryption key must be a separately generated, random 32-byte value encoded as base64. Never put values in chat, source control, command-line arguments, workflow logs, or the portal. Do not reuse the Google Drive key or any production secret.
4. Confirm the staging Worker uses Firebase project `irpa-dbg-staging-a73ec`, not the production Firebase project. Do not deploy while any staging project/credential isolation check is failing.
5. Add the Meta app's authorized testers/developers and grant access only to IRPA-owned or explicitly authorized accounts. Complete consent while signed into the appropriate Meta account.
6. Verify the response from the authenticated `/api/communications/meta/status` route. Expected acceptance: the returned Meta identity and managed Page/Instagram metadata are correct; required permissions are visible; no token fields appear; posting remains disabled. Verify invalid/expired state, role denial, production environment rejection and secret redaction as part of the security suite.

The API code and automated tests do not establish that Meta has approved the app, that the actual IRPA account has consented, that the required GitHub Actions variable/secrets are configured, or that the live staging connection succeeds. The workflow logs only redacted configuration-state markers and must be inspected for `META_OAUTH_DEPLOYMENT_STATE=enabled` and `META_OAUTH_SECRETS_CONFIGURED=true`. Those remain external setup and live-acceptance requirements. Do not merge or deploy to production. Keep posting disabled until authorization, security checks and staging acceptance all pass.


## WordPress authentication diagnostics and cPanel remediation

Website Studio's connection check performs two independent probes: authenticated `GET /wp-json/wp/v2/users/me?context=edit` and unauthenticated `GET /wp-json/`. Authentication redirects are not followed. The diagnostics show the Worker environment, secret presence/length/format only, response status, canonicalized URL, redirect target/count, MIME type, WordPress REST error code/message, WWW-Authenticate presence, Cloudflare Ray ID/auth-bridge diagnostic, and a sanitized response body truncated to 1 KiB. Secret values must never be copied into logs, tickets, browser output, or diagnostic payloads.

For an empty HTTP 401 response, the WordPress/cPanel administrator should inspect Authorization forwarding before rotating credentials. Add these directives above the WordPress rewrite block in the site's `.htaccess`:

```apache
RewriteEngine On
RewriteCond %{HTTP:Authorization} ^(.*)
RewriteRule .* - [E=HTTP_AUTHORIZATION:%1]
```

On LiteSpeed/CGI installations, also test:

```apache
SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
```

Then verify the dedicated integration user in WordPress Users → Profile. Revoke its old Application Password and create a replacement named `IRPA Portal`; assign the Editor role (not Administrator). Confirm Application Passwords are enabled, HTTPS is canonical, and security plugins do not block REST authentication. Review Cloudflare WAF/Bot Fight/Super Bot Fight events for the Worker egress and `/wp-json/`; apply a narrowly scoped skip only when the event confirms a false positive.

Set `WORDPRESS_BASE_URL` to the exact canonical HTTPS origin (for example, `https://www.irpa.or.tz` or `https://irpa.or.tz`, whichever does not redirect). The editor's environment hostname restrictions remain mandatory: production may use only the two production hostnames; staging may use only `staging.irpa.or.tz`. Bind all three WordPress secrets to the same Worker environment that serves the portal. For example, use `wrangler secret put WORDPRESS_USERNAME --env production` and `wrangler secret put WORDPRESS_APPLICATION_PASSWORD --env production` only when the serving Worker is production; use `--env staging` for the staging Worker. Never put secret values in GitHub, issue comments, logs, or the portal.

Acceptance requires authenticated `users/me` HTTP 200 with the expected integration account and Editor role, public REST discovery, page/post listing, draft-only editing, and independent approval before any public publication. No production data or documents should be changed during diagnosis.
