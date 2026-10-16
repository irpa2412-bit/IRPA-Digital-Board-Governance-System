# Communication & Media Website Integration — Configuration and Secrets Checklist

**Purpose:** prepare the isolated staging acceptance environment for PR #418. This checklist is a release gate, not authorization to change production.

## Safety rules

- [ ] Use a dedicated staging Cloudflare Worker, Firebase project, WordPress site, cPanel account/document root, test identity, and mail sender.
- [ ] Never substitute production credentials or production URLs for missing staging values.
- [ ] Never put secret values in source control, issue comments, chat, screenshots, browser code, or workflow logs.
- [ ] Configure credentials in GitHub Actions Secrets and non-sensitive environment settings in GitHub Actions Variables. Use only the staging-specific names below.
- [ ] Keep the production Worker, production secrets, production Firebase project, and live IRPA website unchanged until staging acceptance and release approval.
- [ ] The staging workflow must fail closed if a required value is missing or fails isolation validation.

## A. GitHub Actions Secrets — required for staging

In **Repository → Settings → Secrets and variables → Actions → Secrets**, verify each item is present and belongs to the isolated staging environment. Tick the checkbox only after verifying the value's provenance and scope; never paste the value into this checklist.

### Cloudflare staging access

- [ ] `STAGING_CLOUDFLARE_API_TOKEN` — dedicated, active API token scoped to the staging account/resources needed to verify the token, manage the staging KV namespace and deploy the staging Worker; must not have production deployment permissions.
- [ ] `STAGING_CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID containing the dedicated staging Worker and staging KV namespace.

### Firebase and staging test identity

- [ ] `STAGING_FIREBASE_PROJECT_ID` — isolated staging project ID; must not equal `irpa-digital-board-governance`.
- [ ] `STAGING_FIREBASE_SERVICE_ACCOUNT_JSON` — service-account JSON for that exact staging project; its `project_id` must exactly match `STAGING_FIREBASE_PROJECT_ID`; grant only required staging permissions.
- [ ] `STAGING_FIREBASE_WEB_API_KEY` — Web API key belonging to the isolated staging Firebase project.
- [ ] `STAGING_TEST_EMAIL` — dedicated staging reviewer/test account, not a real user's production account.
- [ ] `STAGING_TEST_PASSWORD` — password for that dedicated staging test account; rotate after exposure and do not reuse a production password.

### Existing staging Drive and mail credentials

- [ ] `STAGING_GOOGLE_DRIVE_CLIENT_ID` — OAuth client approved for the staging Drive integration.
- [ ] `STAGING_GOOGLE_DRIVE_CLIENT_SECRET` — matching staging OAuth client secret.
- [ ] `STAGING_GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY` — dedicated staging token-encryption key; never reuse the production key.
- [ ] `STAGING_SMTP_PASSWORD` — credential for the staging/test SMTP service only; it must not authenticate to the production mail service.

### Isolated staging WordPress

- [ ] `STAGING_WORDPRESS_BASE_URL` — HTTPS URL of a non-production WordPress staging site; hostname must not be `irpa.or.tz` or `www.irpa.or.tz`.
- [ ] `STAGING_WORDPRESS_USERNAME` — dedicated least-privilege staging integration account.
- [ ] `STAGING_WORDPRESS_APPLICATION_PASSWORD` — application password for that staging account only; never use the main WordPress administrator password.

### Isolated staging cPanel

- [ ] `STAGING_CPANEL_BASE_URL` — staging hosting endpoint using HTTPS, port `2083`, and path `/`; verify independently that it belongs to the staging account, not the production hosting account.
- [ ] `STAGING_CPANEL_USERNAME` — staging cPanel account username.
- [ ] `STAGING_CPANEL_API_TOKEN` — token scoped to the staging cPanel account and required file operations only.
- [ ] `STAGING_CPANEL_DOCUMENT_ROOT` — verified staging document-root-relative directory; never point it at production content.
- [ ] `STAGING_CPANEL_TEST_FILE` — existing, disposable, relative `.txt` filename in the staging document root, without slashes, hidden-path segments, or executable extensions; record the original content securely for recovery.

## B. GitHub Actions Variables — required non-secret staging configuration

In **Repository → Settings → Secrets and variables → Actions → Variables**:

- [ ] `STAGING_IRPA_APP_URL` (currently wired as an Actions secret by the workflow) — HTTPS URL of the isolated staging application; not the production Firebase Hosting URL or live website. Keep the current workflow's expected secret name unless the workflow is deliberately changed in the same reviewed PR.
- [ ] `STAGING_SMTP_HOST` — dedicated test SMTP hostname; must not be `mail.irpa.or.tz`.
- [ ] `STAGING_SMTP_PORT` — `465` or `587`, matching the staging SMTP service.
- [ ] `STAGING_SMTP_FROM` — approved staging/test sender; must not be `info@irpa.or.tz`.

The staging workflow checks these mail settings before deployment and uses them in the generated staging Worker configuration. Do not use production SMTP settings or a sender that could deliver unintended live communications.

## C. Configuration and isolation checks

- [ ] Staging Worker name is exactly `irpa-google-drive-gateway-staging`.
- [ ] Generated Worker configuration sets `IRPA_ENVIRONMENT=staging`.
- [ ] Firebase project ID and service-account `project_id` match and are not production.
- [ ] Staging Firestore collection prefix is `staging_`; staging KV binding is `DRIVE_KV` and points to the dedicated staging namespace.
- [ ] Staging app URL and WordPress URL use HTTPS and are not production endpoints.
- [ ] Staging SMTP host and sender are not production values.
- [ ] cPanel endpoint, account, document root and test file are verified as staging-only by the hosting administrator.
- [ ] Cloudflare token is staging-specific; no production token fallback exists in the workflow.
- [ ] No secret values are printed by the workflow. Logs show presence/validation results only.
- [ ] Review the generated staging configuration before deployment; ensure it contains no production project ID, production app URL, production mail endpoint, or production KV namespace.
- [ ] Confirm production Worker configuration and secrets remain unchanged.

## D. Live staging acceptance checklist

- [ ] Workflow prerequisites pass without bypassing any checks.
- [ ] Staging health endpoint returns the explicit staging marker.
- [ ] Unauthorized and non-reviewer accounts are denied website and cPanel writes.
- [ ] WordPress connection check succeeds; staging pages/posts can be listed and read.
- [ ] A dedicated staging test page can be edited; public rendering is verified and original content is restored.
- [ ] Approved article publishing succeeds; duplicate/retry behavior is safe and the public URL is verified.
- [ ] cPanel can list/read the designated test file, write a marker, return a rollback snapshot, and restore the exact original content.
- [ ] Traversal paths, hidden paths, executable extensions, oversized content and invalid endpoints are rejected.
- [ ] Audit records identify actor, action, target, outcome and time without recording secrets.
- [ ] Media upload/download, editorial workflow and exports are verified on desktop and mobile where applicable.
- [ ] Required portal tests, gateway tests, build, security checks and browser regressions pass on the exact PR head.
- [ ] Existing invitation, signature, meeting, finance and other governance portals pass regression checks.

## E. Release gate — do not skip

- [ ] Exact PR head SHA and all required CI results reviewed.
- [ ] Staging read/write/rollback acceptance evidence reviewed.
- [ ] Production configuration and secrets confirmed unchanged.
- [ ] Required review and protected-branch checks pass.
- [ ] Merge only after all gates above pass.
- [ ] Production deployment and live website edits require their own explicit authorized release step after merge; merge alone does not authorize or prove production readiness.

**Current known blocker at checklist creation:** the staging deployment workflow failed at the required-secret preflight, so the staging Worker deployment and live WordPress/cPanel acceptance steps were skipped. This checklist must be completed by an authorized administrator who can provision the isolated credentials and endpoints. Never invent credentials or use production values to make the checks green.
