# Signature Gateway completion plan

Baseline: PR #738 merged at e3d3f0c746ed1fec1345a3bb46edacac43ee7c72.

## Scope
- Owner activation and send operations through Gateway routes.
- Append-only signature audit events through the Gateway audit chain.
- Logged-in member signing through POST /api/sign/submit.
- Authenticated signer's list of signed documents.
- Completion and archive document/envelope mirror updates.
- Enable VITE_IRPA_CRYPTOGRAPHIC_SIGNING_ENABLED=true in staging builds only; preserve production value.
- CI static reachability gate: fail if a Firestore write SDK call remains reachable from the signing flow.
- Staging end-to-end acceptance with stage-by-stage PASS/FAIL and first error line.

## Exclusions and invariants
- Skip profile, signer identity, member/employee register enrichment and translation-request reads.
- Do not change Firestore rules, indexes, secrets, production feature flag, or unrelated modules.
- No local tests; GitHub Actions is the verification authority.
- Do not claim staging deployment or acceptance without GitHub Actions and deployed-stamp evidence.
