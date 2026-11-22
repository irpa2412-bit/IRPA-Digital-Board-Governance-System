# IRPA-DGBS Platform Foundations

## Canonical foundations

All new IRPA-DGBS work shall be built against these two controlled foundations:

1. **Governance portal:** the production IRPA-DGBS application domain configured for the Firebase Hosting project.
2. **IRPA mail:** `mail.irpa.or.tz` as the canonical mail-service hostname.

### Mail / Cloudflare rule

`mail.irpa.or.tz` is an email-service hostname, not a normal web-proxy hostname. For SMTP/IMAP/POP3 service it must remain **DNS-only** in Cloudflare unless Cloudflare Spectrum is deliberately configured for the required mail protocol. Cloudflare's standard HTTP proxy does not carry SMTP/IMAP/POP3 traffic.

Required DNS records are provider-specific and must be taken from the actual IRPA mail provider. Do not invent an A/CNAME/MX target. MX, SPF, DKIM and DMARC records must remain DNS records and be configured exactly as supplied by the mail provider.

Firebase Authentication custom SMTP should use `mail.irpa.or.tz` as the SMTP host once the mail provider and credentials are confirmed. SMTP credentials must never be placed in the repository or Vite client bundle.

Firebase Authentication email action links are separate from the SMTP transport. Their HTTPS return/link domain must be a Firebase Hosting custom domain that is registered as an Authentication authorized domain.

## Canonical portal terminology

The user-facing portal name is:

**Authorisation & Approval**

Both terms are singular and use the same British-English convention.

Do not introduce:
- Authorization & Approvals
- Authorisation & Approvals
- Authorization & Approval

Technical Firebase collection names, callable names, legacy workflow identifiers and stored records may retain their existing identifiers during controlled migration so existing data is not silently orphaned. Any identifier migration must be a separately tested data migration with rollback protection.

## Release safety

A mail-domain change must not alter authentication credentials, signatures, administrator records, or workflow data.

A Cloudflare DNS change must be verified before changing Firebase Authentication custom SMTP or email-link configuration.

