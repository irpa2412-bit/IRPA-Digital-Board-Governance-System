# Operational Access Decision and Meeting Portal Implementation

**Decision status:** Owner-approved policy design recorded; runtime access is not enabled by this document or the role catalogue.

## 1. Access decision

A volunteer who is formally assigned official IRPA duties under Executive Director supervision must receive the full set of operational modules, records and workflows needed to perform those assigned duties. Volunteer status alone is not a basis for withholding operational access.

“Full operational access” is duty-complete access, not unrestricted administrator or system-owner authority. It does not by itself confer authority over account/security administration, infrastructure or production deployment, Firestore rules publication, actual-data gate controls, finance approvals/payments/bank signing, procurement approvals/contracts, legally binding signatures, audit evidence, restricted research data, or Board-reserved decisions.

## 2. Conditions before a live grant

Every grant must be bound to:
1. A verified institutional identity and authenticated UID.
2. A current appointment or formal volunteer assignment in the authoritative personnel register.
3. An approved job description and explicit duty/module/record scope.
4. Written Executive Director assignment or delegation where required.
5. Server-side authorization on every applicable read and write path, not only client-side visibility.
6. Tested separation-of-duties, audit and revocation controls.

The Executive Director supervises volunteer official duties and may define, adjust or withdraw the operational duty scope through the controlled governance process. The system must not infer authority from a role title, volunteer label, profile text or client-side role claim alone.

## 3. Confirmed occupancy corrections

The owner has confirmed these positions occupied:
- Director Internal Oversight — engagement category remains unverified; do not classify as employee or volunteer without an authoritative record.
- Programme Officer — volunteer; limited availability retained.
- IT Specialist — volunteer; preliminary college training retained as context, with official duties under ED supervision and task competence/duty scope to be recorded. This does not authorize security administration or production deployment.
- Community Development Officer — volunteer; limited availability retained.

Director of International Oversight is a distinct role and is not substituted for Director Internal Oversight.

## 4. Meeting Portal security boundary

The current Firestore rules source contains a category-aware helper, but the `/meetings/{id}` read rule still permits every signed-in user to read meeting documents. The helper does not protect the collection while that broad rule remains.

Do not claim Meeting Portal category confidentiality is live. A safe correction requires:
- A reviewed, server-enforced read boundary consistent with Firestore query constraints and the participant/invitee access model.
- Query-path alignment so authorized users can retrieve only records they are entitled to read.
- Direct-read, list/query, participant, invitation, category, released-record and data-gate regression tests.
- Staging acceptance and independent review.

The current implementation branch changes both `firestore.rules` and `firestore.staging.rules` so meeting document reads require the category/participant helper. Category-based role reads now require an active member or employee record. The generic client meeting-list and meeting-document adapters are routed through the Cloudflare Gateway, which applies server-side category, initiator, participant and invitation filtering. These are source changes only; rules have not been published and the gateway has not been deployed.

## 5. Release sequence and current gate

1. Correct the confirmed occupancy baseline and record the duty-based access decision. **Implemented in this branch.**
2. Bind each active person to verified identity, current appointment/volunteer assignment, approved job description and ED duty scope. **Pending authoritative records and controlled assignment.**
3. Implement server-side role/module/record authorization and revocation across all applicable routes. **Meeting read-list and get routes implemented in this branch; broader role/module grants and revocation remain pending.**
4. Close the Meeting Portal Firestore read-boundary gap with compatible rules and query changes. **Source changes implemented in this branch; emulator/security validation, staging acceptance, independent review and rules publication remain pending.**
5. Run automated regression/security checks and staging acceptance. **CI triggered; staging acceptance not yet run.**
6. Obtain independent review and merge only after all required checks pass. **Pending.**
7. Publish Firestore rules only after separate exact `DEPLOY RULES` approval; deploy production only after explicit production-release approval and verified staging. **Not performed.**

## 6. Status language

- **Live: No** — no user permissions were activated, no Firestore rules were published, no staging acceptance was completed, and no production deployment was performed.
- **Implemented in branch** means policy, occupancy, Gateway read paths and Firestore rule source changes are committed to a review branch; it does not mean merged or live.
