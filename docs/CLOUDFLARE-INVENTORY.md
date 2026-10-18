# IRPA-DGBS Cloudflare Migration Inventory

Status: Gate 1 evidence consolidation in progress; production cutover disabled.

## Verified from Cloudflare report
- Account ID: 2993bb51b9a54d5b38830ec8e88caed5
- Zone: irpa.or.tz
- Zone ID: f7ba7a38cdc8987dd293f0d60242c9eb
- Reported zone state: Pending
- Plan: Free
- Assigned Cloudflare nameservers: magali.ns.cloudflare.com, wesley.ns.cloudflare.com
- Existing Worker: irpa-google-drive-gateway
- Existing Worker URL: https://irpa-google-drive-gateway.irpa-governance.workers.dev/
- D1: reported not present
- KV: one namespace reported
- Pages: none reported
- Worker routes on irpa.or.tz: none reported
- Zero Trust / Access: not configured
- R2: unverified
- Email Routing: unverified
- Secrets Store: unverified
- DMARC: not present in the report snapshot
- Production Firebase remains the active application boundary.

## Gate 1 manual blockers
These require Cloudflare/registrar access outside this GitHub implementation environment:
1. Registrar nameserver delegation and subsequent Cloudflare Active status.
2. R2 inventory.
3. Email Routing inventory.
4. Secrets Store inventory.
5. Cloudflare API re-authentication.

No Cloudflare resource was created, deleted, rotated, or redeployed by this repository inspection.

## Safety status
- No production DNS cutover performed.
- No Firebase data/authentication change performed.
- No Worker deployment performed.
- No Firestore migration performed.
- No D1 database created.
- No R2 bucket created.
- No SMTP credential written to source.

## Gate 1 decision
CONDITIONAL GO remains appropriate until the five manual items above are evidenced. The repository evidence work for Gate 2 has now been performed against the public GitHub main branch and is recorded in API-PARITY-MATRIX.md.
