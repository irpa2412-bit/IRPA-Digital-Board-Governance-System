# Hosting provider request — email deliverability

This is a read-only diagnostic request for `irpa.or.tz` and `mail.irpa.or.tz`. It does not authorize changes to the application or signing protocol.

Please compare the records below with the attached/latest **Email domain deliverability diagnostics** workflow report and make only the DNS/hosting corrections that the evidence requires.

## DNS records to verify or publish

| Purpose | Name | Type | Required value |
|---|---|---|---|
| SPF | `irpa.or.tz` (or `@`) | TXT | A single SPF policy that includes the actual outbound SMTP IPv4 address observed for `mail.irpa.or.tz`. Do not create a second SPF record. Use the host's confirmed sending IP; do not guess it. |
| DKIM | `<confirmed-selector>._domainkey.irpa.or.tz` | TXT | The exact public key supplied by the hosting mail server after enabling DKIM signing for `irpa.or.tz` (typically a `v=DKIM1; k=rsa; p=...` value). Please confirm the active selector and provide its complete value. |
| DMARC | `_dmarc.irpa.or.tz` | TXT | `v=DMARC1; p=none; rua=mailto:postmaster@irpa.or.tz` |

The exact SPF IP and DKIM selector/key cannot safely be invented in a static request. Populate them from the workflow's observed outbound IP and the hosting control panel's generated DKIM key before changing DNS. If the report shows existing values that are correct, do not replace them.

## Please ask the hosting administrator to

1. Enable DKIM signing for mail sent as `@irpa.or.tz` and confirm the selector and public TXT record.
2. Ensure the single SPF record authorizes the actual outbound sending IP.
3. Publish/confirm DMARC initially with `p=none` so alignment can be monitored without rejecting mail.
4. Check the outbound sending IP against Spamhaus, Barracuda, SORBS and SpamCop and request delisting if it is listed.
5. Check the outgoing mail logs for the affected recipient and provide the SMTP transaction result, including the timestamp, recipient response and queue/message ID.
6. Confirm the reverse-DNS PTR for the outbound IP points to the mail hostname and that the hostname resolves back to that IP.

If SPF, DKIM and DMARC are all correct, please do not change DNS; **please check outgoing logs for the affected recipient** and report the SMTP response.

This workflow does not authenticate to the mail server, send a message, change DNS, or access application/signing data.
