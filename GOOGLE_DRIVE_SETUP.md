# IRPA Google Drive document storage

The governance system now stores controlled PDF documents in the Google Drive account configured for IRPA instead of Firebase Storage.

## Required Google account

Use the IRPA Google Drive account: `irpa2412@gmail.com`.

## Required Google Cloud setup

1. Enable the **Google Drive API** in the Google Cloud project used by the OAuth client.
2. Configure the OAuth consent screen.
3. Use an OAuth 2.0 client that can obtain offline access for the IRPA Drive account.
4. Authorize the application once with the Drive scope:
   `https://www.googleapis.com/auth/drive.file`
5. Obtain the resulting refresh token. Keep it private.

## Firebase Secret Manager

Create these Firebase/Google Cloud secrets for the `irpa-digital-board-governance` project:

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`

Do **not** commit any of these values to GitHub.

The function uses OAuth on behalf of the authorized IRPA Google account. This is intentional: a personal `@gmail.com` account cannot create a Google Workspace shared drive, and a service account should not be used as the owner of the IRPA documents.

## Drive folder structure

On the first successful upload, the system automatically creates:

`IRPA Governance System/Controlled Documents/<Purpose>/`

Examples:

- `IRPA Governance System/Controlled Documents/Signature Source Document/`
- `IRPA Governance System/Controlled Documents/Board Paper/`
- `IRPA Governance System/Controlled Documents/Meeting Document/`

Firestore keeps the governance metadata, authorization information and audit trail. Google Drive holds the actual PDF file.
