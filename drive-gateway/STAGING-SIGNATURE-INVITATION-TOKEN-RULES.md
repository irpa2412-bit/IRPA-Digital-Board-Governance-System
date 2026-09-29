# Staging document-signing invitation token rules

- Expiry: 72 hours from issuance.
- Binding: envelope ID, stored document ID, recipient UID and recipient email.
- Secret storage: only SHA-256(secret) is stored in the staging DRIVE_KV record; the raw secret exists only in the invitation URL.
- Single use: successful redemption marks the staging KV record with `usedAt`; subsequent redemption returns HTTP 403.
- Revocation: deleting the `signature-invite:<tokenHash>` KV record immediately invalidates the token; the 72-hour KV TTL also removes expired records. A future administrative revoke action should delete that key.
- Tampering: modifying any token component or secret causes HTTP 403; malformed/unknown tokens return HTTP 401.
- Wrong signer: the token's recipient UID/email must match the invitation record; otherwise HTTP 403.
- Signer authentication before signing: the invitation token proves possession of the invitation, but it does not grant document-owner privileges. The signer-facing route exposes only the document bound to the token. The signing operation itself must still require the signer identity/session to match the invitation recipient UID before writing a signature.
- Rate limiting: `/api/signature-invitations/send` permits five sends per authenticated sender identity per 10-minute window; further requests return HTTP 429 with `Retry-After`.
- Email content: recipient name, document title and other user-controlled text are HTML-escaped before insertion into the HTML email.
