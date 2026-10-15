# IRPA Communication & Media Portal

## Purpose
Integrated communications workspace inside the existing IRPA Digital Board Governance System. This is an extension of the existing app, not a separate application.

## Included capabilities
- Website article and press-release drafting.
- Social-media copy drafting for export and manual posting.
- Multi-format media upload and archive through the existing authenticated Google Drive gateway, with Firestore metadata and role-based access.
- Asset types include supported PDF, Word, Excel, PowerPoint, OpenDocument, RTF, TXT, CSV/TSV, Markdown, HTML, EPUB, JSON/XML, image, audio and video formats; gateway-supported formats only, with a 25 MB per-file limit in the communications media upload route.
- Media library with searchable type filters, title/tags, original-file download and Google Drive link-out.
- Editorial planning calendar.
- Searchable content library and workflow status counts.
- Draft exports to TXT, Markdown, HTML and PDF without changing approval status or publishing.
- Browser-native image editing (brightness, contrast, saturation, rotation) with PNG/JPEG/WebP export; source assets are not overwritten.
- Audio/video preview, basic trim range selection and WebM export where the browser supports MediaRecorder and media capture.
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
- Media binaries use the existing Google Drive gateway and the Firestore media register stores metadata only; Firebase Storage remains deny-by-default.
- Media upload and download use the authenticated gateway; Communication Media downloads are checked against registered communications roles server-side.
- Image exports and text/PDF exports are created locally in the browser. Audio/video trim exports are real-time browser captures to WebM and depend on MediaRecorder support; the source file is never overwritten.
- This is a self-contained communications production workspace for common editorial tasks, not a professional multi-track nonlinear editor: multi-track audio mixing, noise reduction, frame-accurate timeline editing, advanced colour grading and arbitrary codec transcoding are not provided in this browser-native release.
- External social-network posting is not enabled; each platform requires its own approved API application and secret-backed server integration.

## Known acceptance gates
- Verify multi-format upload and authenticated download in isolated staging for each allowed file type and enforce the 10 MB limit.
- Verify communications-role denial for media downloads, file-size/MIME rejection, and no direct Firebase Storage access.
- Test image edit/export and text TXT/Markdown/HTML/PDF exports on desktop and mobile; verify original assets remain unchanged.
- Test audio/video trim and WebM export on supported browsers, and verify graceful fallback when MediaRecorder or captureStream is unavailable.
- Verify the portal appears only for communications roles, designated reviewers and administrators.
- Run `npm run test:communication-media` and `npm run build`.
- Run Firestore rules tests in the authorised emulator environment.
- Verify WordPress staging publication and failure behaviour with no secret values in logs.
- Confirm the hosting deployment and production secrets are untouched until acceptance is recorded.
