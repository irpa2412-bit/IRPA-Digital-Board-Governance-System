# IRPA Staging Setup Runbook

## Purpose

This runbook establishes a completely separate Firebase/Hosting environment for the IRPA Digital Board Governance System staging Worker.

**Production project:** `irpa-digital-board-governance`

**Required staging property:** the staging Firebase project ID MUST be different from the production project ID.

Do not deploy the staging Worker until all verification gates in this document pass.

---

## 1. Create a separate Firebase project

Create a new Firebase/Google Cloud project dedicated to staging.

Required properties:

- A distinct Firebase/Google Cloud project ID.
- Firebase enabled.
- Authentication enabled.
- Cloud Firestore enabled.
- Firebase Hosting enabled.
- A staging Web App.
- A staging service account.

Required GitHub/Cloudflare secret names only:

- `STAGING_FIREBASE_PROJECT_ID`
- `STAGING_IRPA_APP_URL`
- `STAGING_FIREBASE_SERVICE_ACCOUNT_JSON`
- `FIREBASE_WEB_API_KEY`

The value stored in `FIREBASE_WEB_API_KEY` for staging MUST be the Web API key belonging to the staging Firebase project. Do not reuse the production key.

### Verify project separation

```bash
firebase projects:list
gcloud projects describe <STAGING_FIREBASE_PROJECT_ID> --format='value(projectId)'
test "<STAGING_FIREBASE_PROJECT_ID>" != "irpa-digital-board-governance"
```

Expected result: the final `test` succeeds.

---

## 2. Create the staging Firebase Web App

Create one Web App inside the staging Firebase project.

Retrieve its SDK configuration:

```bash
firebase apps:list --project <STAGING_FIREBASE_PROJECT_ID>
firebase apps:sdkconfig WEB <STAGING_WEB_APP_ID> --project <STAGING_FIREBASE_PROJECT_ID>
```

The returned `projectId` MUST equal `<STAGING_FIREBASE_PROJECT_ID>` and MUST NOT equal `irpa-digital-board-governance`.

Do not paste the SDK configuration or API key into this repository.

---

## 3. Enable Firebase Authentication — Email/Password

In the staging Firebase project:

1. Open Authentication.
2. Enable the Email/Password provider.
3. Keep the same password policy required by the application.
4. Configure the staging Hosting domain as an authorized domain.
5. Add the staging custom Hosting domain, if one is used.
6. Keep `localhost` authorized for controlled local testing where required.

Verify the project identity before changing Authentication settings:

```bash
gcloud projects describe <STAGING_FIREBASE_PROJECT_ID> --format='value(projectId)'
```

The result MUST be the staging project ID.

---

## 4. Create staging Firestore

Create the staging Firestore database in the staging Firebase project.

Use the same security rules as the repository's controlled ruleset, but do not publish them to production as part of staging setup.

Verify:

```bash
firebase firestore:databases:list --project <STAGING_FIREBASE_PROJECT_ID>
gcloud projects describe <STAGING_FIREBASE_PROJECT_ID> --format='value(projectId)'
```

The project identifier returned by both checks MUST be the staging project.

Required staging collections include, as needed by the seeded test environment:

- `adminProfiles`
- `members`
- `employees`
- `invitations`

Do not use `FIRESTORE_COLLECTION_PREFIX` as an isolation mechanism. Project separation is the isolation boundary.

---

## 5. Seed a staging administrator

Create a dedicated staging Firebase Authentication user for the staging administrator.

Record its UID securely outside the repository.

Create:

```
adminProfiles/<STAGING_ADMIN_UID>
```

with the minimum fields required by the application, including:

- `uid`
- `email`
- `name`
- `role`
- `active: true`

The staging administrator must exist only in the staging Firebase project.

Verify the account and profile against the staging project before testing:

```bash
gcloud projects describe <STAGING_FIREBASE_PROJECT_ID> --format='value(projectId)'
```

---

## 6. Create staging Firebase Hosting

Create a staging Hosting site in the staging Firebase project.

Verify the site:

```bash
firebase hosting:sites:list --project <STAGING_FIREBASE_PROJECT_ID>
firebase hosting:sites:get <STAGING_HOSTING_SITE_ID> --project <STAGING_FIREBASE_PROJECT_ID>
```

The site MUST belong to `<STAGING_FIREBASE_PROJECT_ID>).

Set:

```
STAGING_IRPA_APP_URL=https://<STAGING_HOSTING_SITE_ID>.web.app
```

Do not use:

```
https://irpa-digital-board-governance.web.app
```

---

## 7. Frontend staging build variables

The staging frontend build must resolve all Firebase configuration values from the staging Firebase Web App.

Required variable names:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_FIREBASE_VAPID_KEY`
- `VITE_GATEWAY_ORIGIN`

Required values:

- `VITE_FIREBASE_PROJECT_ID` = staging Firebase project ID.
- `VITE_FIREBASE_AUTH_DOMAIN` = staging Firebase Auth domain.
- `VITE_GATEWAY_ORIGIN` = staging Worker origin.
- All other Firebase SDK values = staging Web App values.

Verify the project ID before building:

```bash
test "$VITE_FIREBASE_PROJECT_ID" != "irpa-digital-board-governance"
echo "$VITE_FIREBASE_PROJECT_ID"
```

Do not print or commit API keys or other credentials.

---

## 8. Staging Worker configuration

The single Worker configuration is:

```
drive-gateway/wrangler.toml
```

The staging environment is selected with:

```bash
npx wrangler deploy --env staging --dry-run
```

No manual deployment is authorized by this runbook.

Required staging Worker identity:

```
irpa-google-drive-gateway-staging
```

Required staging variables:

- `FIREBASE_PROJECT_ID`
- `IRPA_APP_URL`
- `ALLOWED_ORIGINS`
- `IRPA_ENVIRONMENT`
- `DRIVE_ROOT_FOLDER_NAME`
- `DRIVE_MOCK`
- `LOCAL_TEST_MODE`
- `ESIGN_MODULE_ENABLED`
- `CLOUDFLARE_AUTH_FUNCTIONS_ENABLED`
- `IRPA_PRODUCTION_CUTOVER`

For the real staging deployment, `FIREBASE_PROJECT_ID` and `IRPA_APP_URL` MUST be the newly created staging values.

The current repository intentionally leaves those two values absent until the staging project exists.

---

## 9. Staging CORS

The staging Worker must allow exactly:

```
https://<STAGING_HOSTING_SITE_ID>.web.app
http://localhost:5173
```

Set the staging `ALLOWED_ORIGINS` value to the comma-separated form:

```
https://<STAGING_HOSTING_SITE_ID>.web.app,http://localhost:5173
```

No production Hosting origin may appear in the staging value.

Verify before deployment:

```bash
test "<STAGING_HOSTING_SITE_ID>.web.app" != "irpa-digital-board-governance.web.app"
```

The production Worker retains its existing production allowlist.

---

## 10. Cloudflare staging secrets

Configure these secret names for the staging Worker only:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `STAGING_GOOGLE_DRIVE_CLIENT_ID`
- `STAGING_GOOGLE_DRIVE_CLIENT_SECRET`
- `STAGING_GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY`
- `STAGING_SMTP_PASSWORD`
- `STAGING_FIREBASE_SERVICE_ACCOUNT_JSON`
- `FIREBASE_WEB_API_KEY`

The service-account secret MUST be:

```
STAGING_FIREBASE_SERVICE_ACCOUNT_JSON
```

Never use:

```
FIREBASE_SERVICE_ACCOUNT_IRPA_DIGITAL_BOARD_GOVERNANCE
```

for the staging Worker.

The staging service account must belong to the staging Firebase project and have only the permissions required for the staging Worker.

---

## 11. Service-account project verification

Before storing the staging service-account JSON, inspect it locally without committing it:

```bash
node -e 'const fs=require("fs");const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log(x.project_id)' <STAGING_SERVICE_ACCOUNT_JSON_FILE>
```

Then verify:

```bash
test "<SERVICE_ACCOUNT_PROJECT_ID>" = "<STAGING_FIREBASE_PROJECT_ID>"
test "<SERVICE_ACCOUNT_PROJECT_ID>" != "irpa-digital-board-governance"
```

Do not print the private key, client secret, or complete JSON.

---

## 12. Layer-by-layer isolation verification

### Firebase project

```bash
gcloud projects describe <STAGING_FIREBASE_PROJECT_ID> --format='value(projectId)'
test "<STAGING_FIREBASE_PROJECT_ID>" != "irpa-digital-board-governance"
```

### Firebase Web App

```bash
firebase apps:sdkconfig WEB <STAGING_WEB_APP_ID> --project <STAGING_FIREBASE_PROJECT_ID>
```

Confirm the returned `projectId` is the staging project.

### Firestore

```bash
firebase firestore:databases:list --project <STAGING_FIREBASE_PROJECT_ID>
```

Confirm the command is operating against the staging project.

### Authentication

Confirm in Firebase Authentication that the Email/Password provider is enabled in the staging project and that the staging administrator UID exists there.

### Hosting

```bash
firebase hosting:sites:list --project <STAGING_FIREBASE_PROJECT_ID>
```

Confirm the Hosting site belongs to the staging project.

### Worker configuration

```bash
cd drive-gateway
npx wrangler deploy --env staging --dry-run
```

The dry-run must resolve the Worker as:

```
irpa-google-drive-gateway-staging
```

The staging configuration must not contain:

```
irpa-digital-board-governance
https://irpa-digital-board-governance.web.app
```

as its Firebase project or Hosting origin.

### Frontend

Before a staging build:

```bash
test "$VITE_FIREBASE_PROJECT_ID" = "<STAGING_FIREBASE_PROJECT_ID>"
test "$VITE_GATEWAY_ORIGIN" = "<STAGING_WORKER_ORIGIN>"
```

---

## 13. Throwaway test data convention

Use clearly identifiable staging-only values:

- Test email: `staging-acceptance-<timestamp>@<test-domain>`
- Test invitation ID: `staging-acceptance-<timestamp>`
- Test member UID: record the generated staging UID.
- Test admin UID: use the dedicated staging administrator only.

Never use a production member, employee, invitation, or administrator account.

---

## 14. Cleanup after acceptance testing

### Firebase Authentication

Delete the throwaway staging Auth user using an approved administrative mechanism for the staging project. Verify the target project before deletion.

For CLI/administrative workflows, operate only against:

```
<STAGING_FIREBASE_PROJECT_ID>
```

### Firestore invitation

```bash
firebase firestore:delete invitations/<STAGING_TEST_INVITATION_ID> --project <STAGING_FIREBASE_PROJECT_ID>
```

### Firestore member

```bash
firebase firestore:delete members/<STAGING_TEST_UID> --project <STAGING_FIREBASE_PROJECT_ID>
```

### Firestore employee, if created

```bash
firebase firestore:delete employees/<STAGING_TEST_UID> --project <STAGING_FIREBASE_PROJECT_ID>
```

### Staging test collection cleanup

If a dedicated acceptance collection is used:

```bash
firebase firestore:delete <STAGING_TEST_COLLECTION> --project <STAGING_FIREBASE_PROJECT_ID> --recursive
```

Review the target path before executing any destructive command.

---

## 15. Final pre-deployment gate

Do not deploy until all statements below are true:

- [ ] Staging Firebase project ID differs from production.
- [ ] Staging Web App belongs to the staging project.
- [ ] Email/Password Authentication is enabled in staging.
- [ ] Staging Firestore exists.
- [ ] Staging Firestore uses the reviewed ruleset.
- [ ] Staging administrator Auth user exists.
- [ ] `adminProfiles/<STAGING_ADMIN_UID>` exists and is active.
- [ ] Staging Hosting site exists.
- [ ] `STAGING_IRPA_APP_URL` points to the staging Hosting site.
- [ ] Frontend `VITE_FIREBASE_PROJECT_ID` points to staging.
- [ ] Frontend `VITE_GATEWAY_ORIGIN` points to the staging Worker.
- [ ] `STAGING_FIREBASE_SERVICE_ACCOUNT_JSON` belongs to the staging project.
- [ ] `FIREBASE_WEB_API_KEY` used by staging belongs to the staging project.
- [ ] Staging `ALLOWED_ORIGINS` contains only the staging Hosting origin and localhost.
- [ ] Production Firebase project ID is absent from staging Worker configuration.
- [ ] Production Hosting origin is absent from staging Worker configuration.
- [ ] `npx wrangler deploy --env staging --dry-run` passes.
- [ ] `ALLOW_STAGING_DEPLOY` remains unchanged until explicit deployment authorization.
- [ ] `ALLOW_PRODUCTION_DEPLOY` remains unchanged and disabled.

**Phase 3 is intentionally outside this runbook and remains locked.**
