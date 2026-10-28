# Provisioning the staging-only Communication website Chair test user

This is a manual, staging-only setup procedure. **Do not run it as part of a release or against production.** No Firestore rules changes are required.

## Required identities

Create two dedicated Firebase Authentication users in the **staging Firebase project selected by the staging gateway configuration**, not in the production project:

- Chair: `irpa-staging-chair-test@staging.irpa.or.tz`
- Editor: `irpa-staging-editor-test@staging.irpa.or.tz`

Use unique generated passwords stored only as GitHub Actions repository/environment secrets. These exact identities are enforced by the acceptance workflow; do not substitute a staff member's or real board member's account. Do not reuse passwords from another environment.

## Provisioning steps (manual; not run by this workflow)

1. Open Firebase Console and explicitly select the staging project. Verify its project ID against the staging gateway's deployment configuration before creating users. If the staging project cannot be positively identified, stop.
2. In **Authentication → Users**, create the two dedicated accounts above with generated passwords. Do not create them in production. Verify their UIDs are distinct from any production users and record no credentials in source control.
3. Assign the minimum Chair/editor application roles using the existing supported application administration path in staging. Do not edit or deploy `firestore.rules`; if the supported path cannot grant the role, stop and request a separately reviewed change.
4. Configure GitHub Actions secrets `STAGING_CHAIR_TEST_EMAIL`, `STAGING_CHAIR_TEST_PASSWORD`, `STAGING_TEST_EMAIL`, and `STAGING_TEST_PASSWORD` with these dedicated identities. The existing `STAGING_FIREBASE_WEB_API_KEY` must belong to the same verified staging Firebase project. Never copy a production API key or credentials.
5. Confirm `STAGING_WORDPRESS_BASE_URL` is exactly `https://staging.irpa.or.tz/` and that the fixed Worker endpoint is the staging `workers.dev` endpoint. Never set a production URL.
6. Run the optional acceptance workflow manually only after the above checks. If either Chair secret is absent, it prints the explicit skip notice and exits successfully without running acceptance.

## Safety and release behavior

The normal tests, build, and lint are the release gate. Staging acceptance is optional and cannot make a release fail when the Chair test email/password secrets are absent. When credentials are present, the workflow fails closed unless the exact dedicated test identities and staging-only hosts are used. It must not be used to provision accounts, alter rules, or test production.
