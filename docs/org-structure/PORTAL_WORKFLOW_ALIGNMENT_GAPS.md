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

## 4. Mandatory release gates still open

1. Emulator access-preservation tests PASS for primary administrator claim and active `adminProfiles` across the tested role-title cases; the live staging test identity and real owner login remain NOT VERIFIED.
2. Restricted-research emulator tests PASS for administrator denial, authority-before-clearance denial, title-only denial, no-custodian denial, Published-status denial, and successful custodian-backed clearance. The generic Documents archive and document-translation source classification crosswalk remains OPEN; no research authority or custodian has been appointed.
3. Approve the three-level directorate / department / unit data contract and exact role crosswalk.
4. Add emulator tests for every affected protected workflow and demonstrate no unauthorized privilege expansion.
5. Mocked backup/rollback tests PASS 5/5, including rollback on failed/skipped publication verification. A live pre-publication backup artifact and live rollback have NOT been executed; they must be captured and verified for each actual publication.
6. Current-head application build, portal navigation, signature gateway, security rules and authenticated browser checks are still running or require final readback.
7. Obtain explicit owner approval for the exact staging rules diff before publication. No staging rules publication has occurred. Production rules, production migration and production deployment remain separately gated.
8. Production rules source is NOT VERIFIED against the live Firebase Console. The owner must provide the exact current Console rules text before any production diff can be prepared or reviewed; repository `firestore.rules` is not proof of the live deployed source.

## 5. Evidence references

- Source audit: `firestore.rules` role and department predicates; `src/App.jsx` navigation routing; `src/pages/SignaturePlatform.jsx`; `src/firebase/signaturePlatform.js`; `drive-gateway/src/index.js`.
- Staging rules evidence: PR #695 merged to `fix/signature-trail-20261024`; PR #696 draft post-merge emulator run PASS — 11/11 staging access/research tests and 5/5 mocked backup/rollback tests. No live rules publication. Staging frontend Hosting and staging Worker deployment PASS; Worker health PASS. Staging-only Worker secrets were injected by the automated staging deploy; no values are recorded here. The staging acceptance job was skipped.
- Organisational and signature validation workflow: `.github/workflows/org-structure-signature-validation.yml` (current run pending at the time of this draft).
