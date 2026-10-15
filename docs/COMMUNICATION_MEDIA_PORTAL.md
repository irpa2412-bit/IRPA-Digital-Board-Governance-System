# IRPA Communication & Media Portal

## Purpose
Integrated communications workspace inside the existing IRPA Digital Board Governance System. This is an extension of the existing app, not a separate application.

## Included capabilities
- Website article and press-release drafting.
- Social-media copy drafting for export and manual posting.
- Media asset/link register for HTTPS URLs and approved Google Drive links.
- Editorial planning calendar.
- Searchable content library and workflow status counts.
- Author submission, designated review/approval, return-for-revision, archival and audit-triggered record changes.
- Server-side WordPress post publishing for approved website articles and press releases.

## Workflow
1. An authorised communications author creates a Draft.
2. The author submits it for approval.
3. The Executive Director, Director Outreach, Director Community Development or authorised Administrator approves or returns it with a recorded note.
4. A designated reviewer explicitly confirms a live publishing action. The callable re-checks the authenticated role and Approved status on the server.
5. WordPress publication metadata and public URL are saved to the record. Firestore server-audit triggers and an explicit publishing audit event record the action.

Saving, scheduling and approving do not themselves publish. The calendar is a planning aid; it does not run a background scheduler. Social channels are draft/export only in this release.

## Website integration prerequisites
WordPress uses a dedicated account with only the required publishing capability and an application password. Never use a personal/main administrator password.

Set these Firebase Secret Manager values in the intended Firebase project:
- `WORDPRESS_BASE_URL`: HTTPS origin or WordPress installation base URL, without credentials, query or fragment.
- `WORDPRESS_USERNAME`: dedicated WordPress integration username.
- `WORDPRESS_APPLICATION_PASSWORD`: WordPress application password.

Use an isolated staging WordPress site first. Set secrets using the Firebase CLI prompts (do not pass values in shell history or commit them):
```sh
firebase functions:secrets:set WORDPRESS_BASE_URL
firebase functions:secrets:set WORDPRESS_USERNAME
firebase functions:secrets:set WORDPRESS_APPLICATION_PASSWORD
```

Then deploy only the callable to the authorised staging project after the branch checks and security review:
```sh
firebase deploy --only functions:publishCommunicationMediaItem --project <isolated-staging-project-id>
```

Do not deploy to production until authenticated staging tests verify role denial, approval enforcement, HTTPS-only endpoint validation, successful publish, failure recovery, duplicate prevention and audit evidence. This code does not configure secrets, create WordPress users, or deploy infrastructure.

## Data protection
- Firestore documents are private to designated communications roles and reviewers.
- Delete is denied for communications records; use Archived to retain history.
- WordPress credentials are server-side Firebase secrets, never browser data or Firestore fields.
- Text entered in the portal is escaped to plain-text paragraphs before WordPress publication.
- Media files remain in the approved Google Drive storage pathway; the media register stores links/metadata rather than opening Firebase Storage access.
- External social-network posting is not enabled; each platform requires its own approved API application and secret-backed server integration.

## Known acceptance gates
- Verify the portal appears only for communications roles, designated reviewers and administrators.
- Run `npm run test:communication-media` and `npm run build`.
- Run Firestore rules tests in the authorised emulator environment.
- Verify WordPress staging publication and failure behaviour with no secret values in logs.
- Confirm the hosting deployment and production secrets are untouched until acceptance is recorded.
