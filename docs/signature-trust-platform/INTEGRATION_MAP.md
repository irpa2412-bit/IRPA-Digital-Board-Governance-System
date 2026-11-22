# Signature Trust Platform — Integration Map

| Existing IRPA area | Signature role | Initial mode |
|---|---|---|
| Member Register | institutional signer identity | read-only adapter |
| Employee Register | institutional signer identity | read-only adapter |
| Administrator profile | privileged identity | read-only adapter |
| Board / committees | governance authority | read-only adapter |
| Department / unit | scope and authority | read-only adapter |
| Delegation register | delegated authority | read-only adapter |
| Meetings | transaction context | read-only adapter |
| Resolutions / voting | authority source | read-only adapter |
| Document Lifecycle | document/version/hash authority | controlled API adapter |
| Finance | finance authority | category-aware adapter |
| Procurement | procurement authority | category-aware adapter |
| HR | personnel authority | category-aware adapter |
| Livestock | departmental authority | category-aware adapter |
| Environment / Conservation | departmental authority | category-aware adapter |
| Outreach / Community Development | departmental authority | category-aware adapter |
| Field / Operations | operational authority | category-aware adapter |
| Research / Knowledge Management | research authority | category-aware adapter |
| Project / Programme | project authority | category-aware adapter |
| Google Drive | working/signed/evidence archive | controlled storage adapter |
| Firestore | transaction/evidence index | server-controlled registry |
| Durable Objects | transaction concurrency | existing boundary |

## Non-coupling rule
Departments and profiles must not import signing implementation directly. Integration passes through adapters so department changes cannot become signing-engine dependencies.
