# IRPA-DBGS Zero-Trust Security and Controlled Change Framework

**Status:** Proposed implementation baseline; not yet enforced in production  
**Owner authority:** IRPA repository owner / designated system authority  
**Scope:** All operational portals, shared services, APIs, data stores, integrations, build and release paths  
**Architecture constraints:** Cloudflare-first; Firebase Spark compatibility; no new Firebase Functions; no production data or deployment changes without separate explicit approval.

## 1. Security objectives

1. Deny unauthenticated and unauthorised access by default.
2. Authorise every sensitive operation server-side, using verified identity, current role and resource scope.
3. Isolate portals while permitting explicitly approved, least-privilege integrations.
4. Prevent unreviewed or accidental changes to operational portals.
5. Detect, contain, investigate and recover from security incidents.
6. Measure security outcomes against a documented threat model. A 95% reduction/prevention target is a test objective, not a guarantee that hacking is impossible.

## 2. Trust boundaries

- **Internet/edge:** untrusted clients, bots, scanners, malicious requests and third-party callbacks.
- **Identity:** Firebase Authentication establishes identity; it does not by itself grant portal or data permissions.
- **Application/API:** Cloudflare Workers and other server endpoints must independently validate authentication, authorisation, input, method, origin where applicable, replay protections and request limits.
- **Portal boundary:** each portal has an explicit capability and data-access map. A portal's UI visibility is not an authorisation control.
- **Data boundary:** Firestore rules and server-side data access enforce least privilege. Secrets and platform tokens remain server-side.
- **Build/release boundary:** isolated branches and staging are untrusted until reviewed, tested and separately authorised for production.

## 3. Required security controls

### 3.1 Edge and API
- Apply Cloudflare managed protections/WAF where available, rate limits and abuse controls to public endpoints.
- Use endpoint-specific rate limits; distinguish login, recovery, read, write, upload and integration callbacks.
- Enforce method and content-type allowlists, bounded request/body sizes, schema validation and safe error responses.
- Use strict CORS allowlists where browser access is required; CORS is not authentication.
- Require authenticated, authorised requests for non-public data and operations.
- Use CSRF protections for cookie-authenticated state-changing routes; validate webhook signatures and timestamps for callbacks.
- Add idempotency/replay controls to sensitive mutations and integration callbacks.
- Do not trust client-supplied role, actor, portal, approval, ownership or environment claims.

### 3.2 Identity and privilege
- Keep Firebase Authentication as the credential authority unless a separately approved architecture decision changes it.
- Enforce server-verified ID tokens and current role/active-account status for sensitive operations.
- Require MFA for privileged roles and sensitive actions; verify actual enrolment/enforcement coverage before claiming compliance.
- Apply least privilege, role separation, session expiry/revocation and secure account recovery.
- Rate-limit login and recovery by multiple risk signals without exposing whether an email/account exists.
- Builders cannot grant themselves privileges, approve their own sensitive changes or release to production by default.

### 3.3 Portal isolation and integration
- Create a central Portal Integration Registry. Each record must specify source, destination, owner/builder, business purpose, data classes, scopes, direction, endpoints, credential reference, expiry/review date, approver, test evidence and status.
- New integrations default to PROPOSED/blocked. Only an independently approved and tested integration can become ACTIVE.
- Use narrow, per-integration credentials/scopes; never share a broad administrator token between portals.
- Validate source and destination permissions on every request. A link or portal URL is not a grant of access.
- Support immediate revocation, credential rotation and an integration kill switch.
- Keep portal data boundaries explicit; no cross-portal reads/writes by convention or implicit trust.

### 3.4 Data and audit
- Preserve deny-by-default Firestore and Storage policies. Any rules change is a separate high-risk change subject to the existing owner approval gate.
- Validate fields, types, lengths, allowed transitions and ownership at the authoritative server/data layer.
- Prohibit client-side writes to privileged audit, credential, role, approval and security configuration records.
- Record security events server-side: actor UID, effective role, action, target, portal, timestamp, outcome, correlation ID and approval/change reference. Avoid logging secrets, tokens, passwords, OTPs or unnecessary personal data.
- Treat audit integrity as tamper-evident, not absolutely immutable: Worker-generated append-only events must be hash-chained with sequence and previous-event hash; periodically sign checkpoints and export them to a separately controlled append-only destination outside the primary administrative trust boundary. Verify chains/checkpoints during audit. Retention and custody remain subject to an approved policy.
- Encrypt secrets in managed secret stores; rotate and revoke compromised credentials. Never put secrets in source, browser bundles, logs or PR descriptions.

### 3.5 Application and supply chain
- Apply context-appropriate output encoding, input sanitisation, safe file handling and content security policy.
- Prevent unsafe dynamic code execution and restrict upload types, size, path and storage destinations.
- Pin or constrain dependencies, review lockfile changes, scan dependencies and build artifacts, and use pinned CI actions where practicable.
- CI must run security tests, portal regression tests and deployment-policy checks. A green build is not a penetration test.

## 4. Change Control Firewall

Every change that can affect an operational portal, shared component, API, data schema, permissions, integration, deployment workflow or security control must have a Change Request containing:

- unique change ID, requester and accountable owner;
- target portal(s), exact files/services/resources and environment;
- purpose, user impact and expected behaviour;
- data classification and requested permissions;
- dependency/impact map, including shared components and downstream portals;
- threat assessment and rollback plan;
- test plan and evidence;
- named independent approver(s), where an independent reviewer exists; record the approver identity and evidence;
- deployment authorisation and post-release verification.

Lifecycle: DRAFT -> IMPACT_REVIEW -> APPROVED_FOR_STAGING -> STAGING -> TESTED -> APPROVED_FOR_RELEASE -> RELEASED -> VERIFIED, with REJECTED, SUSPENDED and ROLLED_BACK exception states.

Interim staffing rule (current IRPA capacity): IRPA currently has no dedicated IT/security staff, so the Owner may sponsor and authorise documentation, inventory and isolated non-production work. This is not acceptance of single-person approval risk. Where a change requires independent approval and no independent approver is available, the change must remain blocked from staging/release or be redesigned to remove that dependency. The Owner cannot self-approve a change that this framework classifies as requiring independent review. The Owner-authorised break-glass accountability in Section 11 is a separate outage decision and is not a standing waiver of change control.

Rules:
- No direct production edits by builders.
- No self-approval for sensitive changes.
- No automatic activation of a portal or integration.
- No unrelated portal changes bundled into a change request.
- Shared components require impact review and regression evidence for every dependent portal.
- Changes to Firestore rules retain the existing firestore-rules-approval gate and owner-applied, fresh approval requirement. Never bypass it.
- Production release requires a separate explicit owner authorisation and any configured protected-environment approval.
- Emergency changes require a documented incident, narrow scope, explicit emergency authority, audit trail and retrospective independent review.
- If impact or test evidence is incomplete, fail closed.

## 5. Security incident response
**Accountable authority:** The IRPA Owner, acting as Executive Director, is accountable for incident command, prioritisation and authorising containment/recovery decisions. The Owner is also the break-glass approving/activating authority under Section 11. This does not imply that an independent responder or technical operator currently exists.

**Contact route:** A dedicated security-incident contact channel and escalation sequence have not yet been designated or verified. Before operational release, IRPA must publish a monitored incident contact route, identify who monitors it and define an escalation path. Do not treat an unverified mailbox or personal account as an operationally monitored security hotline.

1. Detect and classify the event; preserve relevant logs and timestamps.
2. Contain: revoke sessions/credentials, suspend integration, block abusive traffic or disable the affected capability.
3. Assess scope and affected portals/data without destructive investigation.
4. Eradicate the cause and rotate exposed credentials.
5. Recover from verified clean versions/backups; test before restoring service.
6. Record root cause, timeline, affected assets, actions and lessons; obtain approval for remediation.
7. Notify affected stakeholders under IRPA policy and applicable law.

## 6. Security metrics and 95% target

Do not report “95% secure” or “95% impossible to hack.” Use the weighted, version-controlled scenario denominator in the Threat Model. Target at least 95% weighted prevention/containment coverage, with **100% of Critical and High scenarios passing and zero unresolved Critical/High findings** before production activation. Because every Critical/High scenario must pass, the percentage threshold applies principally to Medium/Low scenarios; it is not a substitute for the severity gate. Also track:
- privileged accounts with MFA / total privileged accounts;
- sensitive endpoints with server-side authz tests / total sensitive endpoints;
- portal integrations with approved registry records / total integrations;
- protected changes with approved change requests / total protected changes;
- critical/high vulnerabilities open and remediation age;
- detection and containment time;
- backup restore test success and recovery objectives.

This target does not cover unknown vulnerabilities, compromised trusted accounts/devices, provider outages or every possible attacker technique. Independent penetration testing is required.

## 7. Implementation and release gates

**Phase 0 — inventory and baseline:** map all portals, routes, roles, data collections, Workers, external services, secrets references, CI workflows and deployment paths. Read-only; no production probes that mutate data.

**Phase 1 — control design:** threat model, trust boundaries, endpoint inventory, permission matrix, integration schema and change-control state machine.

**Phase 2 — isolated implementation:** build on this feature branch; add unit, rules-emulator, API authorization, integration isolation and regression tests. No production data access.

**Phase 3 — staging verification:** run only approved staging tests; verify attack cases and portal regression.

**Phase 4 — owner review and release:** separate review/merge/deploy decisions. No production action is implied by branch creation or test success.

## 8. Repository baseline observed on 2026-11-11

Read-only source inspection on main at base commit 9013e162be98bdb8f28d19b7ead7ac9fc5fa75f2 found:
- firestore.rules has a catch-all deny for unmatched Firestore paths and collection-specific rules. Rules must be reviewed collection-by-collection; catch-all denial alone does not prove every explicit rule is safe.
- storage.rules denies all Firebase Storage reads/writes by default.
- portalDefinitions is administrator-managed metadata with department validation; it is not a complete integration permission registry.
- The client authentication implementation uses Firebase Authentication and calls Cloudflare gateway password-attempt services. The source comments describe the supplementary protection as additive; enforcement and failure-mode behaviour need full route-level review.
- A separate Firebase Functions source implementation defines staged attempt/lock/suspension logic, but its presence does not prove deployment or invocation on every login path.
- A scheduled MFA audit/reminder implementation exists in source; this does not prove it is deployed, scheduled or enforcing MFA at authentication or privileged actions.
- firebase.json defines Hosting headers for index.html and administrator.html; a complete review of headers across hosting paths and Worker responses remains required.
- Existing deployment workflows can deploy Firebase resources when changes reach main; protected Environment configuration and all deployment triggers must be verified separately.

## 9. Explicit exclusions for this phase

No production deployment, merge, live-data mutation, Firestore/Storage rules modification, secrets/configuration mutation, social publishing, WordPress/cPanel operation, or changes to unrelated open PRs. Do not add Firebase Functions, billing dependencies or weaken existing safeguards.

## 10. Definition of done

- Complete evidence-based portal and endpoint inventory.
- Threat model and data-flow/permission maps reviewed.
- Security controls implemented in isolated scope with regression coverage.
- All critical/high security tests pass; no unresolved critical/high findings.
- All affected and dependent portal regression tests pass.
- Staging acceptance and recovery tests pass.
- Change-control and integration approvals are enforced server-side, not merely in UI.
- Owner reviews the complete diff and separately authorises merge and production release.


## 11. Break-glass governance reference

The authoritative Owner decision, scope, activation requirements and unresolved operational parameters are recorded in Section 18 of the Threat Model. That section is the single source of truth; this Framework does not restate or expand the decision. Break-glass is not a technical bypass or standing waiver of authentication, MFA, data-access, change-control or deployment safeguards.
