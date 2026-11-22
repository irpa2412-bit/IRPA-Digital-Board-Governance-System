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
