# IRPA Communication & Media Portal

## Purpose
An integrated communications workspace inside the existing IRPA Digital Board Governance System. It reuses the existing authenticated Cloudflare Drive Gateway, Firebase identity and Firestore audit pathways. It does not add a separate app or new storage provider.

## Included capabilities
- Website article, press-release and social-media draft creation.
- Content library, editorial planning calendar, review, approval, return-for-revision and archival workflow.
- Approved website publishing through the existing Cloudflare Worker.
- Read and update WordPress pages/posts through the WordPress REST API.
- cPanel connection verification and restricted static-file editing through cPanel UAPI.
- Media uploads and archive through the existing authenticated Google Drive gateway. Firebase Storage remains deny-by-default.
- Media library, authenticated download, image editing/export, audio/video preview and browser-native trim/export, within the existing gateway's file-size and format limits.

## Website and cPanel access
The portal calls the existing Cloudflare Worker routes:
- `GET /api/communications/site/status` — verifies WordPress and cPanel credentials without returning secrets.
- `GET /api/communications/website/content?type=posts|pages` — reads up to 50 latest editable records.
- `PUT /api/communications/website/content` — updates the title and plain-text body of an existing WordPress page or post.
- `POST /api/communications/website/publish` — publishes an approved article or press release and reconciles by deterministic slug before creating a post.
- `GET /api/communications/cpanel/files` — lists permitted static files from the configured document root.
- `GET /api/communications/cpanel/files?path=<relative-path>` — reads a permitted static file.
- `PUT /api/communications/cpanel/files` — saves a permitted static file through cPanel UAPI.

The cPanel editor intentionally accepts only HTML, HTM, CSS, TXT and JSON files, with a 512 KiB limit. It rejects path traversal, hidden paths, PHP and other executable/script extensions; it does not provide arbitrary shell access, delete-file operations, or unrestricted hosting administration. WordPress page/post content should be edited through the WordPress API. The portal does not embed a cPanel password login session in the browser; it authenticates server-to-server through a restricted cPanel API token.

## Required Cloudflare Worker secrets
Set these as Worker secrets in the correct environment; never commit them or paste them into the portal:
- `WORDPRESS_BASE_URL`: HTTPS WordPress base URL, normally `https://www.irpa.or.tz`.
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

## Authorization and audit
- Every website and cPanel route verifies the Firebase ID token at the Cloudflare Worker.
- Write operations require a registered reviewer role; credentials stay server-side.
- Website publishing is limited to approved website articles and press releases.
- Website publishing and edits record audit events. A successful HTTP response is not by itself proof of public rendering; verify the resulting public URL.
- cPanel writes are restricted to static content file types and record an audit event.
- No Firebase Functions callable is required for website publishing, avoiding a new Cloud Functions billing dependency.

## Acceptance and release gates
1. Run `npm run test:communication-media`, the full required test suite, production build, gateway syntax/security tests and browser regression checks.
2. Verify role-denial behavior for unauthenticated and non-reviewer users.
3. Verify WordPress connection, content list/read/update, approved publishing, failure handling and duplicate reconciliation against isolated staging WordPress.
4. Verify cPanel token authentication, permitted file listing/read/write, path traversal rejection, executable-file rejection and audit evidence against isolated staging hosting.
5. Confirm the public page after a staged edit and verify the previous content is preserved for rollback.
6. Verify desktop and mobile portal usability and ensure unrelated governance portals retain existing behavior.
7. Merge only after all required checks pass; deploy and live-verify only after staging acceptance. Do not claim live integration until the secret-backed connection checks and actual test writes succeed.

Production secrets and deployments must not be changed merely by merging this code.
