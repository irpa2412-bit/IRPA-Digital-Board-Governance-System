# IRPA-DBGS Security Assessment — Initial Source Findings

**Assessment date:** 2026-11-11  
**Repository baseline:** main, commit 9013e162be98bdb8f28d19b7ead7ac9fc5fa75f2  
**Assessment method:** read-only source inspection through repository files  
**Production actions:** none  
**Status:** partial assessment; not a penetration test and not a complete portal inventory. Public-branch edition: implementation-specific exploit details are intentionally minimised pending the Owner's repository-visibility decision. A restricted technical remediation record must preserve exact code-level evidence for authorised implementers.

## Evidence register

| Area | Evidence inspected | Finding | Status |
|---|---|---|---|
| Firestore | firestore.rules | Catch-all deny exists; explicit collection rules still require full audit and emulator tests. | PARTIAL |
| Firebase Storage | storage.rules | All paths deny read/write. | VERIFIED IN SOURCE |
| Portal registry | firestore.rules, src/App.jsx | portalDefinitions controls portal metadata/navigation; not a full integration registry or runtime capability boundary. | VERIFIED IN SOURCE |
| Authentication client | client authentication implementation | Firebase Auth is credential authority. Password-attempt check/clear calls Cloudflare endpoints. | VERIFIED IN SOURCE |
| Password-attempt enforcement | Client and Worker authentication source | Client source contains a fallback that proceeds with Firebase password sign-in when the supplementary security decision service is unavailable. This is a source-level fail-open concern; deployed behaviour is not established. | SOURCE FINDING — DEPLOYMENT NOT VERIFIED |
| Password-attempt Worker | Cloudflare Worker authentication source | The inspected Worker authentication handlers accept caller-asserted failure/state operations without a demonstrated server-verifiable failed-authentication proof. Per-IP enforcement was not visible in the inspected source; external edge controls were not retrieved. | SOURCE FINDING — EDGE CONTROLS NOT VERIFIED |
| Account lockout integrity | Client + Worker password flow | An unauthorised failure assertion may enable targeted account-denial-of-service if no external controls intervene. Exploitability is not established; edge controls and deployed route behaviour were not retrieved. | POTENTIAL HIGH |
| MFA | Scheduled MFA audit/reminder source | Scheduled audit/reminder logic exists in repository source. Deployment, schedule execution and mandatory MFA enforcement are not established. | NOT PROVEN |
| Gateway auth primitive | drive-gateway/src/util.mjs | requireUser verifies a Firebase user through injected verifier and rejects missing UID. | VERIFIED IN SOURCE |
| Document upload | drive-gateway/src/upload.mjs | Upload and retrieval require a user; retrieval checks owner/admin/authorised UID and validates content hash. | VERIFIED IN SOURCE |
| e-sign routes | drive-gateway/src/router.mjs | Envelope operations require user; token-based signing routes permit limited unauthenticated token workflows and need token scope/expiry/replay review. | PARTIAL |
| Document lifecycle | drive-gateway/src/documentLifecycle.mjs | Uses dedicated Firestore admin token and resolves identity from admin/member/employee records; must review each route's action policy and failure modes. | PARTIAL |
| Gateway deployment config | drive-gateway/wrangler.toml | Production and staging environments are separately named/configured. Runtime WAF/rate-limit rules and secret bindings are not established by this file. | PARTIAL |
| Hosting headers | firebase.json | Cache-control headers are defined for index.html and administrator.html; full security-header coverage is not shown. | PARTIAL |
| CI/deploy | .github/workflows/firebase-deploy.yml | Main-branch push can trigger production deployment job with production Environment. Required reviewer configuration is external account state and not verified here. | PARTIAL |

## Priority findings and required decisions

### F-001 — Password-attempt service availability is fail-open (source finding; live deployment unverified)
**Evidence (restricted implementation detail):** source inspection found that the client login path may continue with Firebase password authentication after the supplementary password-security request fails. Exact symbols and route identifiers are intentionally omitted from this public-branch document.

**Risk:** the supplementary attempt/lockout control can be bypassed during endpoint outage or misconfiguration. Firebase Authentication remains the credential verifier, but the additional lockout policy is not guaranteed.

**Required remediation design:** make the authoritative failed-attempt enforcement server-side and atomic with the credential verification flow, or explicitly rely on and verify Firebase/Cloudflare native abuse controls. Do not merely change the client to fail closed without assessing account availability and recovery impact.

### F-002 — Password-failure reporting lacks demonstrated proof of failed authentication (source finding; live deployment unverified)
**Evidence (restricted implementation detail):** source inspection found a Worker-side password-failure reporting path that accepts caller-provided account context without a demonstrated server-verifiable failed-authentication proof. Exact endpoint paths and handler identifiers are intentionally omitted from this public-branch document.

**Risk:** absent effective external rate limiting/challenge controls, an attacker may intentionally increment failures and lock/suspend another user's account. This is a potential account-denial-of-service path, not proof that production is currently exploitable; Cloudflare edge rules were not retrieved.

**Required remediation design:** do not accept client assertion of failed login as authoritative. Evaluate a server-mediated sign-in attempt or a proof-based design, plus independent IP/device and account throttles, anti-automation challenge, generic responses and recovery controls. Verify production and staging WAF/rate-limit rules before rollout.

### F-003 — MFA enforcement and scheduled execution are not established
**Evidence:** a scheduled MFA audit/reminder implementation exists in the repository's `functions/` source tree. Its presence does not prove that it is deployed, scheduled, or enforcing MFA at authentication or sensitive API operations.

**Risk:** reminder coverage may be mistaken for enforcement.

**Required remediation design:** inventory privileged roles and supported Firebase MFA factors; define enforcement at sign-in and at sensitive server operations. Verify with positive/negative tests and recovery process.

### F-004 — Portal definitions are not integration authorisation
**Evidence:** portalDefinitions rules govern administrator-managed portal metadata and department association. No complete source/destination permission registry was found in the inspected files.

**Risk:** a portal link or metadata definition could be confused with permission to access another portal's data or APIs.

**Required remediation design:** add server-authoritative integration registry, explicit scopes, independent approval, expiry/review, audit and revocation. Keep default blocked.

### F-005 — Gateway route inventory and security headers incomplete
**Evidence:** drive-gateway/src/index.js dispatches multiple route families (authentication, meeting, induction, communications, document lifecycle, uploads, signing, release readiness and others). Only a subset was inspected. firebase.json exposes a limited set of Hosting headers.

**Risk:** unreviewed routes may have inconsistent authentication, role checks, CORS, method restrictions, rate limits or response headers.

**Required remediation design:** enumerate every route/method and document its authentication, authorisation, input limits, data access, audit, rate limit and test. Review Worker-level headers and Firebase Hosting headers as separate controls.

## Password-security implementation and deployment status

Source inspection identifies both a client-side login integration and a Cloudflare Worker-side password-attempt implementation. A separate `functions/` source implementation also contains staged attempt/lock logic, and the repository contains scheduled MFA audit/reminder code. **The source alone cannot establish which implementation is active in production, whether both are active, whether any Firebase Function is deployed/scheduled, or which version is serving requests.** No Firebase project deployment inventory, Cloudflare live Worker version, route binding, or runtime trace was retrieved in this assessment. Therefore the live enforcement topology is **NOT VERIFIED**. Do not describe the Functions implementation or MFA reminders as operational controls until deployment and invocation are independently verified. The architecture constraint remains Cloudflare-first, Firebase Spark compatible and no new Functions; this assessment does not authorise enabling or deploying Functions.

## Next read-only assessment tasks

1. Enumerate all gateway route registrations and route-specific authorization checks.
2. Inventory all portal identifiers, modules, role gates, Firestore collections and cross-portal data flows.
3. Inspect all Cloudflare Worker configurations, route bindings, WAF/rate-limit configuration evidence and secret binding names only (never values).
4. Inspect all GitHub Actions workflows, branch protections, required checks, environments and production deployment triggers.
5. Review every Firestore collection rule with positive and negative emulator tests; preserve the current approval gate.
6. Inspect MFA enforcement, token verification, session revocation, account recovery and admin bootstrap.
7. Inspect external OAuth/webhook integrations, scopes, state/nonce validation, signature verification, replay protection and token storage.
8. Build a portal dependency graph and baseline regression suite before changing shared components.

## Evidence limitations

- No production or staging endpoint was probed.
- No live account, user, document, collection, credential, secret or integration record was read or changed.
- No Cloudflare account configuration, Firebase Console configuration, Firebase Functions deployment/schedule inventory, GitHub repository settings, WAF rules, rate-limit rules, production Environment reviewers or deployed Worker version was inspected.
- No tests, workflows, builds, penetration tests or deployments were run.
- Findings marked PARTIAL, POTENTIAL or NOT PROVEN must not be reported as verified vulnerabilities or verified protections.


## Public-branch disclosure and residual-risk handling

This branch's public-facing assessment intentionally avoids exact endpoint paths, handler names and line-level exploit instructions for the password-attempt weaknesses. This is risk reduction, not remediation and not a substitute for access control: removing text does not erase prior Git history or copies. Repository visibility remains an **OPEN Owner decision**; no visibility change has been made. The authorised technical implementation record should be maintained in a restricted location if the repository remains public. No Cloudflare WAF/rate-limit rule has been changed; production edge mitigation requires separate explicit Owner authorisation.

## Owner decisions still open

- Single-approver risk acceptance: **NOT ACCEPTED / NOT RECORDED**. The Owner has not provided an explicit acceptance decision and review date.
- Repository visibility (public/private): **OPEN**.
- Interim production Cloudflare edge rule: **NOT AUTHORISED**.
- Maximum tolerable security-service outage, escalation route, permitted break-glass actions and delegated alternate: **OPEN**. The Owner's accountability decision is recorded only in the Threat Model.
