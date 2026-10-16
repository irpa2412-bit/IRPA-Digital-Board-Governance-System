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
- `PUT /api/communications/cpanel/files` — saves a permitted static file through cPanel UAPI after saving a seven-day snapshot in the existing Cloudflare KV namespace.
- `POST /api/communications/cpanel/rollback` — restores a matching snapshot and keeps the pre-rollback version for seven days.

The cPanel editor intentionally accepts only HTML, HTM, CSS, TXT and JSON files, with a 512 KiB limit. Before each write it reads the existing file and stores a seven-day rollback snapshot in the existing Cloudflare KV namespace; the editor exposes a rollback action and records audit events. It rejects path traversal, hidden paths, PHP and other executable/script extensions; it does not provide arbitrary shell access, delete-file operations, or unrestricted hosting administration. WordPress page/post content should be edited through the WordPress API. The portal does not embed a cPanel password login session in the browser; it authenticates server-to-server through a restricted cPanel API token.

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

Production deployment is gated on six GitHub Actions secrets being configured for the production workflow: `PRODUCTION_WORDPRESS_BASE_URL`, `PRODUCTION_WORDPRESS_USERNAME`, `PRODUCTION_WORDPRESS_APPLICATION_PASSWORD`, `PRODUCTION_CPANEL_BASE_URL`, `PRODUCTION_CPANEL_USERNAME`, and `PRODUCTION_CPANEL_API_TOKEN`. The production workflow validates their presence and endpoint formats before changing the Worker, then transfers the values into Cloudflare Worker secrets without printing them. Do not put these values in source control or paste them into chat.

## Automated staging acceptance prerequisites

The staging workflow runs on the Communication & Media integration pull request and deploys only the dedicated `irpa-google-drive-gateway-staging` Worker. It requires the following repository Actions secrets; values are never printed by the workflow:

- Existing isolated staging infrastructure: `STAGING_CLOUDFLARE_API_TOKEN`, `STAGING_CLOUDFLARE_ACCOUNT_ID`, `STAGING_FIREBASE_PROJECT_ID`, `STAGING_IRPA_APP_URL`, `STAGING_GOOGLE_DRIVE_CLIENT_ID`, `STAGING_GOOGLE_DRIVE_CLIENT_SECRET`, `STAGING_GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY`, `STAGING_SMTP_PASSWORD`. The Cloudflare token must be staging-specific and must not have production deployment permissions.
- Isolated staging Firebase: `STAGING_FIREBASE_SERVICE_ACCOUNT_JSON`, `STAGING_FIREBASE_WEB_API_KEY`, `STAGING_TEST_EMAIL`, `STAGING_TEST_PASSWORD`. The service account project ID must exactly match the staging Firebase project ID, which must not be the production project.
- Isolated staging WordPress: `STAGING_WORDPRESS_BASE_URL`, `STAGING_WORDPRESS_USERNAME`, `STAGING_WORDPRESS_APPLICATION_PASSWORD`. The WordPress hostname must not be `irpa.or.tz` or `www.irpa.or.tz`.
- Isolated staging cPanel account: `STAGING_CPANEL_BASE_URL`, `STAGING_CPANEL_USERNAME`, `STAGING_CPANEL_API_TOKEN`, `STAGING_CPANEL_DOCUMENT_ROOT`, `STAGING_CPANEL_TEST_FILE`. The test-file secret must be a safe relative `.txt` filename within the isolated staging document root.

The workflow also requires Actions variables `STAGING_SMTP_HOST`, `STAGING_SMTP_PORT` (`465` or `587`), and `STAGING_SMTP_FROM`. Staging SMTP host/sender must not be `mail.irpa.or.tz` / `info@irpa.or.tz`; production mail configuration is rejected. The workflow verifies the explicit staging health marker, authenticates a staging reviewer, checks both server-side connections, updates a dedicated staging WordPress test page and verifies its public rendering before restoring the prior state, edits a staging cPanel test file and exercises its seven-day rollback, then verifies path-traversal/executable-path rejection. Missing staging secrets or failed acceptance block release; production credentials must never be substituted. See [COMMUNICATION_MEDIA_READINESS_CHECKLIST.md](COMMUNICATION_MEDIA_READINESS_CHECKLIST.md) for the full configuration checklist.

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

## Supported document and media upload formats

The Media Asset Studio uploads through the authenticated Google Drive gateway; it does not write to Firebase Storage. Each upload is limited to 25 MiB by the current browser route. The selector advertises these formats:

- **Office documents:** PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, RTF, ODT, ODS, ODP.
- **Structured and text content:** TXT, CSV, TSV, Markdown (MD), HTML, JSON, XML, EPUB, ZIP.
- **Images:** JPG/JPEG, PNG, WEBP, SVG, GIF, BMP, TIF/TIFF, AVIF.
- **Audio:** MP3, WAV, M4A, AAC, OGG, FLAC.
- **Video:** MP4, WEBM, MOV, AVI, MKV.

This is the supported list, not a claim that every proprietary, encrypted, damaged, or future file format is supported. MIME type is checked against the allowlist; unknown types are rejected. Files are stored as originals in the existing Drive pathway and registered as metadata in Firestore. Authenticated download is by Drive file ID. Image adjustments and browser-native audio/video trimming export a new local derivative and never overwrite the original. The current upload route accepts one file per submission; upload additional files as separate submissions.

## Live website editor and preview

The Publishing Setup workspace loads existing WordPress pages or posts, lets an authorised reviewer edit the title and content, and saves through the authenticated Cloudflare Worker. The editor provides an **unsaved, sandboxed live preview** that updates from the current form contents when preview is open. The preview iframe has an empty sandbox (no script execution), sends no referrer, and is explicitly a visual approximation rather than the live theme. It does not publish or save content by opening preview.

The server-side editor enforces Firebase authentication, active registered reviewer roles, HTTPS WordPress configuration, a 30,000-character content limit, allowlisted HTML tags/attributes and URL schemes, and audit recording. Saving is an immediate live WordPress write; the interface requires an explicit confirmation before the write. Review the preview, confirm the target page/post and keep a copy of the prior content before saving. Confirm the returned public URL after the write. If the WordPress or cPanel connection is not configured and verified, the portal must show the connection failure rather than simulate a successful edit.

The cPanel file editor is deliberately separate and restricted to existing static HTML/HTM, CSS, TXT and JSON files (512 KiB maximum). It does not edit PHP, run commands, create arbitrary files, or provide hosting administration. WordPress page/post editing should be preferred for content managed by WordPress. Secrets remain in the server-side Worker environment, never in the browser bundle or Firestore.