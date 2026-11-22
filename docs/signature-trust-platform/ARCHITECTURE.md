# IRPA Digital Signature & Trust Platform — Isolated Build

## Baseline
Based on production baseline bb8acaba0fb658992c86681785fb208a4541b929. Existing production signature behavior is not replaced by this branch.

## Safety boundary
No changes to production authentication, Member/Employee authorization, Board/Finance/Procurement/HR behavior, production Firestore rules, or production Cloudflare configuration. No private signing keys in Firestore, Drive, localStorage, or source control.

## Integration architecture
React/Vite UI -> Signature Orchestrator -> Identity Assurance / Signing Authority / Consent -> Signing Ceremony -> Crypto/PKI adapter -> Evidence/Trust -> Document Lifecycle -> Final Archive.

Cloudflare Durable Objects remain the concurrency/state boundary. Firestore stores controlled metadata/evidence indexes. Google Drive stores documents/evidence. Cryptographic keys use protected infrastructure.

## Institutional integration adapters
The platform resolves authoritative records from Board Member, Employee, Administrator, Department/Unit, Committee, Delegation, Meeting/Resolution, and Document Lifecycle sources without duplicating their authority.

## Department routing
Board/Governance; Executive/Administration; Finance; Procurement; Human Resources; Livestock; Environment/Conservation; Outreach/Community Development; Field/Operations; Research/Knowledge Management; Project/Programme.

## Assurance levels
1. BASIC — external link + consent.
2. INSTITUTIONAL — authenticated IRPA account + registered profile.
3. STRONG — institutional identity + second factor + authority validation.
4. CRYPTOGRAPHIC — protected private key + X.509 certificate + document signature.
5. REGULATED — applicable Tanzanian trust-service pathway, subject to legal/compliance approval.

## Merge gates
Unit tests; existing gateway tests; root production build; signature security tests; staging integration; member/employee trials; authority/revocation; cryptographic verification; archive/evidence verification; explicit production approval.

No merge or production deployment is authorized by this document.
