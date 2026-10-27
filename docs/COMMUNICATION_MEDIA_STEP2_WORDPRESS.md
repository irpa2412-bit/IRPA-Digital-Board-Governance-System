# Website integration contract (step 2)

Publishing remains disabled by default. The existing WordPress REST routes in `communicationsSite.mjs` are the source of truth; do not create a second WordPress client or bypass its staging-host guard.

Worker secret names (values must never be shown in UI or logs):
- `WORDPRESS_BASE_URL`
- `WORDPRESS_USERNAME`
- `WORDPRESS_APPLICATION_PASSWORD`

When any secret is missing, display **Not connected** and list only missing secret names. Continue to expose the restricted cPanel static-file editor as a separate fallback; it is not a WordPress publishing substitute. English and Kiswahili content must remain separate records. Require approval before publishing; preserve revision snapshots before mutation and verify restore operations. Phone preview should use the same sanitized content as the editor.

Production hostname protections must not be bypassed for staging validation. Configure staging secrets only against the dedicated non-production WordPress host.
