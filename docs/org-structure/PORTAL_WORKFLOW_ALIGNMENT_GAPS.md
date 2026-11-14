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

The staging rules define `researchAuthority()` to include `admin()`; `researchStudies` and other research collections allow reads through `researchUser()`. The staging emulator gate in draft PR #695 confirmed that an administrator can read a RESTRICTED, uncleared research study.

**Disposition:** BLOCKED for release. The current staging rules still include Administrator in `researchAuthority()`, and the deployed staging policy has not been changed. In this PR's draft-only `firestore.rules`, Administrator and department-only membership have been removed as research authority; restricted data access requires an explicit active Research role in the Member/Employee register; `Published` no longer grants read access; and cross-portal review/shared-information reads are held to Research authority. Emulator tests now cover administrator denial, explicit Research Officer access, and denial based only on Published status. A custodian-backed clearance schema (classification, named approver and verified custodian) is not yet implemented, so the draft deliberately enables no external research-data sharing. Do not waive these controls or treat Administrator status, record type, or Published status as clearance.

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

1. Pass the owner and staging administrator preservation tests, including the live staging test identity.
2. Resolve the restricted-research read gap without weakening the default RESTRICTED policy.
3. Approve the three-level directorate / department / unit data contract and exact role crosswalk.
4. Add emulator tests for every affected protected workflow and demonstrate no unauthorized privilege expansion.
5. Save the currently deployed rules backup and prove the rollback path before each publication.
6. Pass current-head build, portal navigation, signature gateway, security rules and browser acceptance checks.
7. Obtain explicit owner approval for the exact staging rules diff before publication. Production rules, production migration and production deployment remain separately gated.

## 5. Evidence references

- Source audit: `firestore.rules` role and department predicates; `src/App.jsx` navigation routing; `src/pages/SignaturePlatform.jsx`; `src/firebase/signaturePlatform.js`; `drive-gateway/src/index.js`.
- Staging emulator evidence: draft PR #695 — primary admin claim PASS, active adminProfiles PASS across seven role-title cases, title-only Administrator denial PASS, restricted research denial FAIL. Build PASS; staging isolation preflight PASS; Cloudflare staging deployment SKIPPED.
- Organisational and signature validation workflow: `.github/workflows/org-structure-signature-validation.yml` (current run pending at the time of this draft).
