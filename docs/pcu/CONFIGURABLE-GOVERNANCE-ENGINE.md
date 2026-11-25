# Portals Control Unit — configurable governance engine

PCU is an organisation-independent governance and duty-management domain model. Tenant configuration supplies node labels, hierarchy, reporting edges and workflow policy. The IRPA seed is one tenant configuration and contains exactly seven directorates. The legacy IRPA authority catalogue is deliberately not used as the generic schema or copied into this seed.

## Invariants
- Every organisational node and reporting edge is tenant-scoped.
- Node types are configurable; hierarchy depth is not fixed.
- Multiple parents are supported where configured; cycles are rejected.
- Approval-path resolution must produce exactly one path; zero or multiple paths are rejected.
- Duties may be assigned to organisational nodes or named identities.
- Acknowledgement is receipt evidence only. Assignment and acknowledgement never issue claims, portal access, financial authority, signature authority or privileged capabilities.
- Initiator/approver separation and auditor independence are checked by the domain engine.
- Assignment records carry versions, effective dates, supersession and revocation fields. A production persistence adapter must make audit events append-only.

## Safe integration
This addition is additive. Do not replace config/org-structure-authority.json: existing Role Descriptions, signature authority and governance workflows still import it. Inventory and migrate those consumers through a compatibility adapter in a separately tested integration change. Do not bulk-convert personnel, infer incumbents, create vacancies or activate runtime permissions. Firestore persistence requires tenant-scoped paths and server-side authorization before production records are enabled.

## Verification
Run node --test tests/pcu-governance-engine.test.mjs. Repository CI and existing governance/security suites remain mandatory. Staging must be verified before production promotion. This domain-engine addition alone is not evidence of a live deployment.
