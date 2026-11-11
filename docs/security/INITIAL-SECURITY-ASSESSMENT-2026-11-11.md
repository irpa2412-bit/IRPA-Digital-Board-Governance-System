# IRPA-DBGS Security Assessment — Initial Source Findings

**Assessment date:** 2026-11-11  
**Repository baseline:** main, commit 9013e162be98bdb8f28d19b7ead7ac9fc5fa75f2  
**Assessment method:** read-only source inspection through repository files  
**Production actions:** none  
**Status:** partial assessment; not a penetration test and not a complete portal inventory.

## Evidence register

| Area | Evidence inspected | Finding | Status |
|---|---|---|---|
| Firestore | firestore.rules | Catch-all deny exists; explicit collection rules still require full audit and emulator tests. | PARTIAL |
| Firebase Storage | storage.rules | All paths deny read/write. | VERIFIED IN SOURCE |
| Portal registry | firestore.rules, src/App.jsx | portalDefinitions controls portal metadata/navigation; not a full integration registry or runtime capability boundary. | VERIFIED IN SOURCE |
| Authentication client | src/firebase/auth.js | Firebase Auth is credential authority. Password-attempt check/clear calls Cloudflare endpoints. | VERIFIED IN SOURCE |
| Password-attempt enforcement | src/firebase/auth.js | Login continues with Firebase Authentication if the password-security endpoint is unavailable. This is a fail-open path for the additional attempt-control layer. | HIGH-PRIORITY REVIEW |
| Password-attempt Worker | drive-gateway/src/cloudflareAuth.mjs | Password-attempt state/failure/clear routes accept POST and use caller-supplied email; no Firebase identity verification is performed in these three handlers. No per-IP rate limiting is visible in this module. | HIGH-PRIORITY REVIEW |
| Account lockout integrity | client + Worker password flow | A caller can submit the public password-failure route for an email without proving a corresponding failed Firebase sign-in. If no external edge control blocks it, this may permit targeted account lockout/denial of service. Verify Cloudflare WAF/rate-limit configuration before classifying as exploitable. | POTENTIAL HIGH |
| MFA | functions/mfaSecurityAudit.js | Scheduled audit/reminder logic exists. This file alone does not establish mandatory MFA at login or privileged operation time. | NOT PROVEN |
| Gateway auth primitive | drive-gateway/src/util.mjs | requireUser verifies a Firebase user through injected verifier and rejects missing UID. | VERIFIED IN SOURCE |
| Document upload | drive-gateway/src/upload.mjs | Upload and retrieval require a user; retrieval checks owner/admin/authorised UID and validates content hash. | VERIFIED IN SOURCE |
| e-sign routes | drive-gateway/src/router.mjs | Envelope operations require user; token-based signing routes permit limited unauthenticated token workflows and need token scope/expiry/replay review. | PARTIAL |
| Document lifecycle | drive-gateway/src/documentLifecycle.mjs | Uses dedicated Firestore admin token and resolves identity from admin/member/employee records; must review each route's action policy and failure modes. | PARTIAL |
| Gateway deployment config | drive-gateway/wrangler.toml | Production and staging environments are separately named/configured. Runtime WAF/rate-limit rules and secret bindings are not established by this file. | PARTIAL |
| Hosting headers | firebase.json | Cache-control headers are defined for index.html and administrator.html; full security-header coverage is not shown. | PARTIAL |
| CI/deploy | .github/workflows/firebase-deploy.yml | Main-branch push can trigger production deployment job with production Environment. Required reviewer configuration is external account state and not verified here. | PARTIAL |

## Priority findings and required decisions

### F-001 — Password-attempt service availability is fail-open
**Evidence:** src/firebase/auth.js loginWithEmail catches non-lockout errors from passwordSecurityRequest, marks passwordSecurityAvailable false and continues to signInWithEmailAndPassword.

**Risk:** the supplementary attempt/lockout control can be bypassed during endpoint outage or misconfiguration. Firebase Authentication remains the credential verifier, but the additional lockout policy is not guaranteed.

**Required remediation design:** make the authoritative failed-attempt enforcement server-side and atomic with the credential verification flow, or explicitly rely on and verify Firebase/Cloudflare native abuse controls. Do not merely change the client to fail closed without assessing account availability and recovery impact.

### F-002 — Public password-failure endpoint can be invoked without proof of failed authentication
**Evidence:** drive-gateway/src/cloudflareAuth.mjs handles /api/auth/password-failure using only a syntactically valid email, then increments account-keyed state. The handler does not verify Firebase authentication or a server-verifiable sign-in failure proof. State and clear handlers are also public by design in the inspected module.

**Risk:** absent effective external rate limiting/challenge controls, an attacker may intentionally increment failures and lock/suspend another user's account. This is a potential account-denial-of-service path, not proof that production is currently exploitable; Cloudflare edge rules were not retrieved.

**Required remediation design:** do not accept client assertion of failed login as authoritative. Evaluate a server-mediated sign-in attempt or a proof-based design, plus independent IP/device and account throttles, anti-automation challenge, generic responses and recovery controls. Verify production and staging WAF/rate-limit rules before rollout.

### F-003 — MFA enforcement is not established
**Evidence:** functions/mfaSecurityAudit.js identifies active registered users and queues reminders when MFA is absent. The inspected source does not prove authentication or sensitive APIs reject privileged accounts without MFA.

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
- No Cloudflare account configuration, Firebase Console configuration, GitHub repository settings, WAF rules, rate-limit rules, production Environment reviewers or deployed Worker version was inspected.
- No tests, workflows, builds, penetration tests or deployments were run.
- Findings marked PARTIAL, POTENTIAL or NOT PROVEN must not be reported as verified vulnerabilities or verified protections.
