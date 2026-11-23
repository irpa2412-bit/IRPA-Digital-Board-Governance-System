# Meeting Portal officer-access grant-source audit — 22 November 2026

## Scope and safety

Read-only source inspection against `main` at `908b314ab0de566d057b4093f4addb11ca434ff3`. No Firestore records, envelopes, rules, secrets, environment variables, SMTP settings, signing logic, PDF/hash/certificate/archive logic, or production services were changed. This is an evidence record, not an implementation or deployment claim.

## Confirmed source paths and current behavior

### Identity and governance records

- `src/firebase/data.js` exports `COLLECTIONS.members = "members"` and `COLLECTIONS.employees = "employees"` (line 12). These are the Member and Employee registers used by the application.
- `functions/index.js`, callable `resolveAuthenticatedLoginContext`, reads matching active records from `members` and `employees`, and builds an `authorities` array from role/title/position/department identity values. The inspected implementation reads `role`, `roles[]`, `assignedRoles[]`, `selectedRoles[]`, `roleAssignments[]`, `department`, `unit`, `jobTitle`, `position`, `title`, and `designation`. It does not, in the inspected resolver, read a separate extended-permission grant collection or resolve duty-level grants/expiry/revocation.
- `src/App.jsx`, `Shell`, derives `authorityRecords` from `profile.authorities`; when absent, it synthesizes one authority per login category. Its resolver path is explicitly disabled by `IRPA_GATEWAY_CONNECTED=false`. This means the shell can fall back to identity-derived authorities rather than a fresh server-verified grant result.
- The dashboard label “AUTHORIZED USER · ACCESS CATEGORIES” is rendered by `LoginCategoryBadges` in `src/App.jsx`; it displays the selected authority category, not a resolved list of active duty grants.

### Meeting Portal checks

- `src/firebase/meetingPolicy.js` contains hard-coded category role lists in `MEETING_CATEGORIES` and hard-coded checks in `canRegisterMeeting`, `canAccessMeetingCategory`, `canEditMeeting`, and `canVoteInMeeting`. These compare role strings; they do not consult active extended-permission grants.
- `src/firebase/data.js:getAccessibleMeetingRecords` builds an identity from active Member/Employee profiles and role arrays, then calls `canAccessMeetingCategory`. It does not resolve a duty-level governance grant.
- `src/firebase/meetingGatewayApi.js` routes client actions through the authenticated Cloudflare Gateway, including `/api/meeting-register/list` and `/api/meeting-quorum/assess`. The Worker implementation and its per-duty authorization predicates have not yet been mapped to exact source lines in this audit.
- `firestore.rules` contains independent meeting predicates including `meetingRegistrar`, `meetingCategoryReadAllowed`, `meetingSessionController`, and the `/meetings`, `/participants`, and related match blocks. These are a separate authorization layer and have not been changed.

## Diagnosis supported by inspected source

The client-side Meeting Portal authorization is role-string based, not grant based. A head-of-department/officer's approved extended permission is therefore not considered by the current client policy unless it happens to match one of the hard-coded role strings. The shell also disables its authenticated Gateway authority resolver and can synthesize role-only authority records. These are confirmed grant-propagation defects. They do not yet establish which Worker or Firestore predicate denied any particular seeded request.

## NOT RETRIEVED — required before implementing the shared grant resolver

The exact governance-tool collection/document path and schema that stores the already-processed extended permission, including grant status, effective/expiry/revocation fields, duty identifiers, and role/department scope, have not been identified from the inspected source. The current resolver does not expose those fields. The precise record/function shown in the dashboard as the source of the extended grant is also NOT RETRIEVED.

No permission schema, collection, field name, duty mapping, or default was invented in this audit. The shared client/Worker resolver must not be implemented until this existing authoritative source is traced from the governance workflow write path to its read path.

## Required next implementation gates

1. Trace the governance tool's actual grant-write function and its exact Firestore collection/document fields; then trace the dashboard's read function.
2. Add one shared policy contract over those exact active grants and use it in the Meeting Portal screen and Worker. Preserve existing Meeting Portal behavior for duties with no governance grant.
3. Seed the real record shapes for head of department, officer, ordinary member, guest, and outsider; test every duty and identify the first denying layer with exact source line.
4. Change Firestore rules only if emulator evidence proves a granted duty is denied there; isolate that rule change in its own PR.
5. Run quorum/voting and all requested portal, email-signing-contract, and regression suites. Deploy only through approved no-secret-sync workflows and verify live build stamps after required checks.

## Change classification

Documentation/audit only. No application code, Worker routes, Firestore rules, deployment workflow, or production configuration changed.


## Historical PR/window search — 22 November 2026 follow-up

### Candidate resolution

- **PR #863 — “Record duty-based operational access and correct confirmed role occupancy”** is the matching Meeting Portal implementation candidate found in the historical thread. Issue #860 comment 7074837267 identifies its branch as `fix/meeting-operational-access-implementation-20261122`. The branch diff from the retrieved `main` baseline includes `config/org-structure-authority.json`, `docs/MEETING-PORTAL-OPERATIONAL-ACCESS-DECISION.md`, `docs/portal-protection/records/meeting-portal.json`, `docs/portal-protection/windows/meeting-portal.json`, `drive-gateway/src/meetingPortal.mjs`, `drive-gateway/src/meetingServices.mjs`, two Worker router tests, both Firestore rules files, `src/firebase/data.js`, policy tests and authority tests.
- PR #863's own description explicitly says **no Firebase claims, individual user permissions, personnel identity bindings or live role assignments were changed**, no Firestore rules were published, and no staging acceptance or production deployment occurred. The branch's `docs/MEETING-PORTAL-OPERATIONAL-ACCESS-DECISION.md` says access remains default-deny until identity, current appointment/assignment, approved duty scope and server-side enforcement are verified; it explicitly records **Live: No**. It is not evidence of a one-hour live permission grant.
- Issue #860 comment 7074969161 records the server-side list/get route work and confirms that no live permission activation occurred; it also says the required Firestore approval label and separate exact `DEPLOY RULES` input remain outstanding. The later issue comment 7075034100 again says PR #863 is unmerged and **Live: No**.
- **PR #895** is the Signature Portal recovery-screen PR for envelope `IRPA-ENV-2026-11501354`; its comments concern a Signature Portal 72-hour repair window and recovery telemetry. It is unrelated to Meeting Portal access.
- **PR #901** is this documentation-only grant-source audit. It has no access grant or repair-window approval.
- Searches for PR titles/bodies containing Meeting Portal + Internal Oversight Director, Executive Director, head of department/HOD, extended permission, one-hour/60 minutes, or full Meeting Portal access did not surface a separate matching one-hour grant PR. The branch `fix/meeting-operational-access-implementation-20261122` is the #863 branch, not a separate later grant.

### Repair-window records

- The root `docs/portal-protection/repair-window.json` records a Meeting Portal operational-readiness window opened `2026-11-20T11:08:48Z`, duration 48 hours, closing `2026-11-22T11:08:48Z` (14:08:48 EAT). Its scope is a broad operational-readiness/test list, not a one-hour access grant. It had expired by the current follow-up at `2026-11-22T16:27:58Z` (19:27:58 EAT).
- The separate `docs/portal-protection/windows/meeting-portal.json` window opened `2026-11-21T20:23:03Z`, duration 72 hours, expires `2026-11-24T20:23:03Z`; its reason and Change Record are for REAL/TRIAL meeting deletion protection, not officer access.
- PR #863's per-portal Change Record is about category/participant/invitation read boundaries and expressly prohibits granting live individual permissions without separate approvals. No one-hour start/end interval or active grant record is present in the inspected branch decision, per-portal window, or per-portal Change Record.

### Exact access and time-frame conclusion

The #863 policy text authorises duty-complete operational access for formally assigned volunteers under Executive Director supervision, while reserving system-owner/security, production deployment, finance, procurement, signature, audit, restricted-research and Board-reserved powers. It does **not** specify a grant to the Executive Director, Director of Internal Oversight, or every head of department; it does not enumerate an all-duties Meeting Portal grant; and it supplies no one-hour start/end timestamps. The branch explicitly leaves individual live permissions default-deny. Therefore the requested one-hour grant is **NOT FOUND / NOT RETRIEVED**, not safely re-applicable as an exact change.

No data grant document or fields with effective/expiry timestamps were identified in the repository evidence. The inspected resolver builds authorities from identity/role fields and does not read an explicit time-bounded duty grant.

### Execution decision

Do not create a replacement 24-hour window or reapply #863 as though it were the requested one-hour grant: that would substitute a different access policy and could activate access beyond the user's specified roles, duties and time bounds. No runtime or rules change is safe until the actual one-hour PR/record is identified. No deployment is justified by the evidence above.
