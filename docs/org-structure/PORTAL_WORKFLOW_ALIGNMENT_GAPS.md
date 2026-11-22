# Portal and Workflow Alignment — Gap Register

**Status: DRAFT / NOT A RELEASE APPROVAL.** This register records the source-level alignment completed for the proposed 13-directorate structure and the remaining authorization work. No Firestore rules, live data, role assignments, secrets, or deployments are changed by this document.

## 1. Completed in this draft

| Area | Result | Boundary |
|---|---|---|
| Directorate navigation | All 13 directorates and all listed departments have explicit module-routing entries in `src/App.jsx`. | Navigation only; Firestore remains authoritative for data access. |
| Executive Office | Recorded as a central office separate from the 13 directorates. | Does not create a fourteenth directorate or appoint an Administrator. |
| Legacy profile compatibility | Existing department labels remain mapped while the new hierarchy is reviewed. | No automatic role rename or data migration. |
| Administrator access | Primary administrator context continues to expose all registered portal modules; a job title of `Administrator` cannot select administrator mode and is limited to Dashboard and read-only Role Descriptions. | Emulator/source tests are not a live owner sign-in test. |
| Board signer choices | Signature Portal has distinct Chairperson, Vice Chairperson, Secretary, Treasurer and Member options. | Does not appoint legal signatories. |
| Dual-role signer verification | Browser and Cloudflare Gateway match scalar and multi-role Member/Employee register fields, including structured role assignments. | Only roles on the authenticated user's active register record can match. |
| Ambiguous titles | Director Field / Field Director, Director Research / Research Director and other flagged titles remain distinct exact-match values. | No automatic alias merging. |

## 2. Confirmed workflow and rules gaps

### Finance and Procurement department routing

The current rules source still uses legacy department labels in key predicates:

- `financeDepartmentMember()` requires `department == "Finance & Administration"` and legacy Finance Unit / Accounting Unit values.
- `procurementDepartmentMember()` requires `department == "Finance & Administration"` and `unit == "Procurement Unit"`.
- `validProcurementDepartment()` still lists legacy names such as `Environment & Sustainable Rangeland Management` and `Field Department`, rather than the approved names `Sustainable Rangeland Management and Climate Resilience` and `Operations`.
- `validProcurementUnit()` still validates the old unit catalogue. The new structure has a three-level directorate / department / unit hierarchy and must not be guessed into the older two-field department / unit model.

**Disposition:** BLOCKED pending a reviewed directorate / department / unit data contract and emulator tests. The navigation layer has compatibility mappings, but the protected Firestore rules have not been changed.

### Research data protection

The pre-merge staging rules baseline included `admin()` in `researchAuthority()` and allowed `researchUser()` to read restricted research records. PR #695 has since merged a draft-only restrictive rules change into the staging branch; no live rules publication occurred.

**Disposition:** BLOCKED for release. The draft rules now require a separate active `researchAuthorities/{uid}` appointment record; a job title, department, administrator claim or admin profile does not confer Research authority. Research records are unreadable to everyone—including Research authority—until `clearedForSharing`, `CLEARED_FOR_SHARING`, a classification, a named approver with an active authority record, and a matching active `researchCustodians/{uid}` appointment record are all present. Only the appointed Research authority can apply that clearance. Client-side creation or modification of authority/custodian appointments is denied pending a separately approved appointment workflow; no authority or custodian has been appointed by this draft. `Published` status does not grant read access, and cross-portal review remains governed by the target portal's own reviewer roles. Emulator tests cover administrator denial, authority-without-clearance denial, title-only denial, no-custodian denial, Finance review isolation, Published denial and successful custodian-backed clearance. The staging rules source now matches the draft production-repository research controls. PR #695 was merged into the staging branch; PR #696 is a draft test-only post-merge validation. Live staging rules remain unpublished. Do not waive these controls or treat Administrator status, record type, or Published status as clearance. The generic Documents archive and document-translation workflow still require a source-portal classification crosswalk so research-origin attachments and translation requests cannot inherit generic Administrator read access; this remains an explicit cross-portal security gap before merge.

### Role arrays in other workflows

The Signature Portal's browser and Cloudflare Gateway signer verification now support scalar role fields and multi-role arrays. Several non-signature workflow predicates in the existing rules source still inspect a single `role` field or fixed role-name lists. These require a separate role-by-role audit before multi-role records can be relied on across Finance, Procurement, HR, Meeting, Authorization and Communications workflows.

**Disposition:** NOT YET ALIGNED. Do not infer that signature dual-role support automatically grants the same recognition in other workflows.

### Portal coverage

Market Development, Livestock Development, Sustainable Rangeland Management and Community Development currently route to existing Reports / Actions / Risk Register modules. There is no dedicated Market Development portal in the current app module registry.

**Disposition:** Existing modules are mapped without inventing new portal capabilities. A dedicated portal build is a separate product decision.

## 3. Signature matrix status

The technical selector and verifier are aligned to the five distinct Board roles and authenticated Member / Employee register records. The verifier now requires an explicit Active/Activated register status, reads only the authenticated person’s current Member/Employee records, and excludes department/unit labels from signatory authority matching. Browser and Cloudflare Gateway normalisation are covered for prefixes and repeated whitespace. The draft signing matrix still does not appoint signatories for governance instruments, bank instruments, procurement contracts or research clearance. Those assignments require the applicable Board resolution, bank mandate, approved delegation, custodian appointment and separation-of-duties evidence.

The interim sole-approver remains a scoped, default-off control with zero payment authority; it must not be treated as a blanket legal signing delegation.

## Runtime role-literal crosswalk still incomplete

A source scan of `anyInstitutionalRole([...])` in the current repository `firestore.rules` found 68 distinct string literals. 45 match a title in the 55-entry draft catalogue; 23 do not. This is an inventory only—no alias or permission was inferred.

Unmatched values requiring explicit classification are:

- Possible legacy role titles: `Community Development Director`, `Departmental Director`, `Departmental Manager`, `Director Field`, `Director Field Department`, `Director Operations`, `Environment Director`, `Field Director`, `Fundraising Officer`, `HR Director`, `Internal Oversight Director`, `Livestock Director`, `Operations Director`, `Outreach Director`, `Procurement Manager`, `Procurement Team Member`, `Secretary to the Board`, `Staff`.
- Portal/department labels, not signing authority: `Communication & Media`, `Communication and Media`, `Communications & Media`, `Communications and Media`.
- Permission constant, not a role: `RESTRICTED_DOCUMENT_UPLOAD`.

These values must be mapped to an exact approved role, retained as an explicitly separate legacy role, or removed through a separately reviewed permission change. Do not silently alias titles or treat department/unit labels as signing authority. The scan does not yet include every role literal in frontend modules, Cloudflare Workers or every Firestore collection rule; the full runtime crosswalk remains a merge blocker.

## 4. Mandatory release gates still open

1. Emulator access-preservation tests PASS for primary administrator claim and active `adminProfiles` across the tested role-title cases; the live staging test identity and real owner login remain NOT VERIFIED.
2. Restricted-research emulator tests PASS for administrator denial, authority-before-clearance denial, title-only denial, no-custodian denial, Published-status denial, and successful custodian-backed clearance. The generic Documents archive and document-translation source classification crosswalk remains OPEN; no research authority or custodian has been appointed.
3. Approve the three-level directorate / department / unit data contract and exact role crosswalk.
4. Add emulator tests for every affected protected workflow and demonstrate no unauthorized privilege expansion.
5. Mocked backup/rollback tests PASS 5/5, including rollback on failed/skipped publication verification. A live pre-publication backup artifact and live rollback have NOT been executed; they must be captured and verified for each actual publication.
6. Current-head application build, portal navigation, signature gateway, security rules and authenticated browser checks are still running or require final readback.
7. Obtain explicit owner approval for the exact staging rules diff before publication. No staging rules publication has occurred. Production rules, production migration and production deployment remain separately gated.
8. Production rules source is NOT VERIFIED against the live Firebase Console. The owner must provide the exact current Console rules text before any production diff can be prepared or reviewed; repository `firestore.rules` is not proof of the live deployed source.
9. The existing Production Promotion Gate created functional promotion-proof tags on draft PR heads. The workflow is now guarded to skip draft PRs and trigger on `ready_for_review`. Three tags were created automatically on earlier draft commits; they remain in the repository pending owner decision and were not deleted. These tags are not deployments.

## 5. Evidence references

- Source audit: `firestore.rules` role and department predicates; `src/App.jsx` navigation routing; `src/pages/SignaturePlatform.jsx`; `src/firebase/signaturePlatform.js`; `drive-gateway/src/index.js`.
- Staging rules evidence: PR #695 merged to `fix/signature-trail-20261024`; PR #696 draft post-merge emulator run PASS — 11/11 staging access/research tests and 5/5 mocked backup/rollback tests. No live rules publication. Staging frontend Hosting and staging Worker deployment PASS; Worker health PASS. Staging-only Worker secrets were injected by the automated staging deploy; no values are recorded here. The staging acceptance job was skipped.
- Organisational and signature validation workflow: `.github/workflows/org-structure-signature-validation.yml` (current run pending at the time of this draft).


## 6. Owner-confirmed constitutional/personnel corrections

The authority register now records the Executive Director as OCCUPIED and the permanent employee Board Secretary office as occupied by the same incumbent in a separate capacity. The Board Chairperson and Treasurer are occupied; several Board Member positions are occupied. Board Members serve four-year terms, renewable once, with a maximum tenure of eight years. The Board Secretary office is not subject to that Board-member tenure cycle.

The owner-confirmed volunteer baseline includes the Director of International Oversight, Programme Officer, Outreach Officer, Community Development Officer, Director of Finance and Administration, and an IT Specialist in preliminary college training. Volunteer status is not employment and creates no implied approval, banking, procurement, administrator, security, research or production authority. The next senior Director represents the Executive Director during absence within the constitutional and recorded acting scope; the specific individual must be established from an approved seniority order.

IRPA confirms existing authorised bank accounts and signatories. The current bank mandate and supporting Board resolutions remain authoritative; the organisational matrix must not invent or alter account details, signatories, signing combinations or limits.

## 7. Job-description release design

Required sequence: Executive Director reviews the complete catalogue; Executive Director releases the approved version to the Administrator; Administrator assigns each description to a verified current delegate; Administrator releases the assigned description to that delegate; acknowledgement and appointment/delegation evidence are recorded. The Administrator cannot rewrite descriptions, create appointments, expand delegations or grant Board-reserved powers. A released description or acknowledgement does not activate permissions by itself.

**Runtime gap remains:** this repository change updates the constitutional/policy data model and documentation. It does not implement the authenticated Executive Director review queue, Administrator assignment/release UI, delegate acknowledgement workflow, immutable server-side transition enforcement or role-specific live access. Those require a separately tested runtime implementation. No Firestore rules or live personnel records are changed by this change.


## 8. Intranet job-description workflow implementation (2026-11-15)

A dedicated `Job Description Administration` portal has been added for the Executive Director and Administrator. The authenticated `Role Descriptions` portal now also exposes the assigned delegate's acknowledgement workflow.

Implemented workflow states:
- `RELEASED_TO_ADMINISTRATOR` — Executive Director releases a versioned JD snapshot.
- `ASSIGNED_PENDING_DELEGATE_ACKNOWLEDGEMENT` — Administrator assigns an active Member/Employee identity and records appointment/engagement, delegation/resolution and date references.
- `ACKNOWLEDGED_PENDING_ED_VERIFICATION` — the assigned delegate acknowledges within DBGS.
- `VERIFIED_PENDING_SERVER_AUTHORIZATION` — Executive Director records the governing evidence reference reviewed.

Firestore rules enforce actor-specific, ordered transitions; deny reserved Board/Executive Director/Administrator role assignment; prevent record deletion; and require the permission-activation flag to remain false. Existing server-side Firestore audit triggers record changes. No Cloud Function, external workflow SaaS or email delivery is added.

**Important remaining boundary:** this workflow deliberately does not activate application permissions, update Firebase claims, alter member/employee role assignments, create administrator profiles, or confer signature/bank authority. A separately designed and tested server-side authorization release is still required before operational access can be granted from a verified appointment/delegation. The workflow is not yet deployed or live-verified.


## 9. Governance correction — Executive Director assignment authority (2026-11-15)

The Administrator is **not** vested with authority to assign positions, determine responsibilities, appoint or select delegates, or amend job descriptions. The earlier draft implementation that exposed recipient selection and assignment fields to the Administrator has been superseded.

The operative process is now:
1. Executive Director selects the intended person, determines and approves the position and JD responsibilities/limits, and records appointment/engagement and written delegation/resolution references with effective/review dates.
2. Administrator receives that exact approved instruction and distributes the versioned JD to the named person through DBGS. Administrator has no recipient-selection or content-edit permission.
3. Named delegate acknowledges receipt in the intranet portal.
4. Executive Director verifies the acknowledgement and evidence record.

Firestore production and staging rules have been aligned to enforce this boundary: only the Executive Director can create the assignment instruction; the Administrator can only change the workflow state from `ED_APPROVED_PENDING_ADMIN_DISTRIBUTION` to `RELEASED_TO_DELEGATE` without changing the named recipient, JD snapshot or governing references; only the designated recipient can acknowledge; only the Executive Director can verify. Workflow permission activation remains false at every stage.

The revised implementation is in the development branch and requires the full CI/security-rule/build review before merge. It has not been deployed or live-verified.
