# IRPA-DBGS Handover

**Updated:** 22 November 2026  
**Repository:** `irpa2412-bit/IRPA-Digital-Board-Governance-System`

## First task for the next session — retention lock and controlled disposal

Create one small, separate PR implementing the policy in [Records Retention and Disposal](policies/records-retention-and-disposal.md). Keep this PR separate from #845. Do not weaken any existing check. Do not publish Firestore rules.

### Required implementation

1. **Retention date and record inheritance**
   - Set `retainUntil = proceedings date + 10 calendar years` on every real proceedings record.
   - The proceedings date is the meeting date for a single-day meeting and the final day of proceedings for a multi-day meeting. It is never the signing date.
   - Every minute, resolution, vote, attendance record, action and recording belonging to the meeting inherits exactly the same `retainUntil`.
   - The Worker enforces the deadline server-side. No disposal is permitted before `retainUntil`, regardless of requester, role, administrator, approval or client route.
   - An active legal hold blocks disposal even after the retention period expires.

2. **Signature-portal disposal workflow and separation of duties**
   - Build the request and authorisation process on the existing signature portal and authorisation matrix.
   - Enforce this exact sequence: (i) disposal request with record identifiers, reason, retention date and legal-hold status; (ii) review and due signature of the authorisation document by the **Director of Internal Oversight**; (iii) authorisation by the **Executive Director**; (iv) execution by an administrator.
   - The administrator executes only; the administrator cannot decide relevance, approve disposal, or bypass either authority.
   - Record the reason and legal-hold flag, and preserve the full approval/signature evidence.
   - No deletion button or other direct deletion path for real proceedings records anywhere in the application.
   - Every disposal creates a permanent audit entry containing the disposed document's SHA-256 hash and the request, reason, approvals, executor and timestamp.

3. **Trial-meeting boundary**
   - Preserve administrator deletion for meetings explicitly classified as `TRIAL`, subject to the already-established safeguards.
   - Missing, invalid or ambiguous environment values remain fail-closed as `REAL`. Preserve the existing legal-hold, retention, pending-review and version checks.

4. **Member-register role verification — report before implementation assumptions**
   - Inspect the authoritative member/employee register and report whether the exact role **Director of Internal Oversight** exists and is occupied.
   - Inspect and report whether **Executive Director** exists and is occupied.
   - Do not treat **Director of International Oversight** as equivalent to **Director of Internal Oversight** without an authoritative role-register decision.
   - If either required role is missing, report it explicitly; do not invent a holder or silently substitute another role.
   - Repository-only evidence available at this handover is not a live member-register read: `docs/org-structure/ROLE_JOB_DESCRIPTION_REVIEW_PACK.md` records Executive Director as occupied and lists Director Internal Oversight as a role, while its confirmed volunteer list names Director of International Oversight (not Director of Internal Oversight). `src/pages/Members.jsx` reads the live Firestore members collection, which was not queried in this documentation-only wind-up. Therefore, current live-register occupancy for Director of Internal Oversight is **NOT VERIFIED**; Executive Director is documented as occupied, but its current live-register entry is also **NOT VERIFIED**. Resolve both from the authoritative register before workflow implementation.

### Acceptance evidence

- Tests prove the Worker rejects disposal before `retainUntil` for every actor and route, including administrator requests.
- Tests prove multi-day meetings use the final proceedings date and all meeting artefacts inherit one common retention date.
- Tests prove legal holds block disposal.
- Tests prove the signature/authorisation order and separation of duties; administrator execution alone cannot approve.
- Tests prove real records expose no direct deletion control/path and trial deletion retains every existing safeguard.
- Tests prove every disposal emits a permanent audit entry with the exact document SHA-256 hash.
- Member-register evidence records the exact presence/occupancy result for both required roles.
- All required checks are green from GitHub evidence. Do not record PASS manually and do not weaken or skip checks.

## Current verified state and boundaries

- **PR #845:** merged on 22 November 2026. Merge commit: `57368a8c2ceb418178aa28e5707b02605851dc83`. It remains the REAL/TRIAL deletion-boundary protection change; the retention policy was not added to it. Its merge did not deploy production or establish live verification.
- **PR #845 base before merge:** `40c7cfa33a53871a48c8568a5ff3f876f2df5ac5`. This is the pre-merge comparison point, not an instruction to roll back.
- **Production deployment / live verification:** NOT VERIFIED in this wind-up. Do not claim deployed or live-safe from merge status alone.
- **Firestore rules:** not published or changed by this documentation work. Do not publish them.
- **Retention policy:** recorded in `docs/policies/records-retention-and-disposal.md`; runtime enforcement is not yet implemented.
- **Member-register occupancy:** see the explicit NOT VERIFIED status above; no live Firestore member data was read.
- **Scope of this documentation change:** documentation only. No application source, Worker, tests, Firestore rules, deployment configuration or production environment changed.

## Next-session execution order

1. Complete the retention lock and controlled-disposal PR described above, beginning with authoritative member-register role verification.
2. Separately inspect the merged #845 required-check and post-merge state; establish deployment and live-verification status only from fresh evidence. Do not publish Firestore rules.
3. Resume other queued protection work only after checking current PR heads, required checks and workflow queue state; park anything that cannot be verified safely.

## Approval and safety phrases

- Owner's recorded policy instruction: “Do not weaken any check, and do not publish Firestore rules.”
- The owner expressly directed that #845 merge as planned and that the policy must not be added to #845.
- The owner expressly amended the retention calculation to use the proceedings date, with the final day used for a multi-day meeting.
- This handover does not grant authority to deploy, publish Firestore rules, weaken checks, bypass approvals or treat an unverified state as PASS.
