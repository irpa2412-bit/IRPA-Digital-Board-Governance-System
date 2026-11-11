# IRPA-DBGS Threat Model and Security Acceptance Scenarios

**Status:** Design baseline; source review in progress  
**Branch:** `security/irpa-dbgs-zero-trust-20261111`  
**Assessment basis:** Repository source inspection only. No production or staging probing has been performed.  
**Security target:** At least 95% of the weighted, in-scope attack scenarios below must be prevented or contained in repeatable tests. This is a measurable engineering objective, not a guarantee that the system is 95% impossible to hack.

## 1. System boundary and trusted enforcement

IRPA-DBGS is a multi-portal governance application using Firebase Authentication and Firestore, a Cloudflare Worker gateway, Cloudflare-managed services, GitHub source control and deployment workflows, and external integrations including website, email, Google Drive and Meta/social services.

**Trusted enforcement tier:** Cloudflare Workers are the primary server-side enforcement tier for gateway APIs, integration authorisation, privileged operations, security event processing and audit checkpoint generation. Firebase Authentication remains the identity credential authority. Firestore Security Rules remain an independent data-access boundary. GitHub is the source-change and deployment-control boundary.

Client-side checks, portal visibility, React route guards and client-supplied role claims are usability controls only; they are not trusted authorisation decisions.

No new Firebase Functions, paid Firebase dependencies, Firestore/Storage rules changes, production configuration changes or production deployment are included in this design approval.

## 2. Assets to protect

| Asset | Security objective | Principal impact if compromised |
|---|---|---|
| Board, member, employee and administrator identities | Confidentiality, integrity, availability | Impersonation and governance takeover |
| Board papers, minutes, resolutions and signatures | Confidentiality, integrity, non-repudiation | Forged approvals or disclosure |
| Finance, procurement, grants and HR records | Confidentiality and integrity | Fraud, privacy breach, financial loss |
| Portal permissions and integration links | Integrity and least privilege | Cross-portal access and data exfiltration |
| Website, communication and social publishing | Integrity and controlled release | Unauthorised public statements |
| Firebase/Cloudflare/GitHub credentials | Confidentiality and containment | Infrastructure takeover |
| Audit trail and backups | Integrity and recoverability | Concealed actions and unrecoverable loss |
| Source code and deployment pipeline | Integrity and availability | Malicious code release |

## 3. Actors and trust boundaries

- **External unauthenticated actor:** internet user, bot or opportunistic attacker.
- **Authenticated ordinary user:** valid account without administrative authority.
- **Privileged IRPA user:** administrator, board officer, finance/procurement approver or portal owner.
- **Builder/developer:** proposes and implements changes; does not automatically receive production release authority.
- **External integration:** WordPress/cPanel, Google Drive, Meta, email or other connected service.
- **Compromised endpoint/session:** attacker operating through a user's browser or stolen session.
- **Compromised credential/service:** leaked API token, Worker secret, Firebase credential or GitHub token.
- **Insider/misconfiguration:** authorised person or automation making an accidental or unauthorised change.

Trust boundaries are: browser to Worker; browser to Firebase; Worker to Firebase/Firestore; Worker to external services; GitHub contributor to protected branch; GitHub Actions to deployment environment; and primary operational account to independent audit/backup custody.

## 4. Threat assumptions and non-assumptions

Assume attackers can inspect public client code, call public endpoints directly, alter request bodies and headers, replay requests, enumerate exposed routes, automate requests, and possess an ordinary user account. Assume a user session or one integration credential may be compromised.

Do not assume that hiding a portal, disabling a button, a client-side role check, a CORS policy, or a document's existence in the repository provides server-side protection. Do not assume Cloudflare WAF/rate-limit configuration, Firebase App Check enforcement, MFA enforcement, branch protection or protected-environment reviewers are active until independently inspected.

A full compromise of GitHub organisation ownership, Cloudflare account ownership, or Firebase project ownership is outside the initial 95% scenario denominator; these are treated as catastrophic residual risks requiring separate account-level controls and recovery.

## 5. Prioritised threat register

| ID | Scenario | Risk | Required control and test evidence |
|---|---|---|---|
| AUTH-01 | Attacker submits repeated password-failure reports for a victim email and causes lockout | Critical | Remove trust in client assertions; count actual authentication outcomes server-side or use verifiable one-time proof; account and IP throttles; backoff and recovery tests |
| AUTH-02 | Password-attempt service is unavailable and login silently bypasses protection | High | Fail closed or documented bounded degraded mode with stricter controls; outage tests; no silent bypass |
| AUTH-03 | Attacker bypasses client role/portal checks and calls Worker endpoints directly | Critical | Worker verifies Firebase token, current server-side role, resource scope and action permission; direct API negative tests |
| AUTH-04 | MFA reminder exists but privileged action is accepted without MFA | High | Enforce step-up MFA for defined privileged roles/actions; test enrollment, challenge, recovery and revocation |
| AUTH-05 | Password reset/recovery flow bypasses normal identity assurance | High | Bind recovery to verified factors, short-lived single-use challenges and auditable recovery; replay and takeover tests |
| PORTAL-01 | User accesses another portal's records or actions by changing IDs | Critical | Resource-level authorisation and portal scope checks at Worker and Firestore; cross-portal matrix tests |
| PORTAL-02 | Portal metadata is mistaken for an integration permission grant | High | Server-side default-deny Integration Registry; independent approval and narrow scopes |
| API-01 | Unauthenticated, wrong-method, malformed or oversized requests reach sensitive routes | High | Route/method/auth matrix, schema validation, size limits and negative tests |
| API-02 | OAuth/webhook state is replayed, forged or used outside its intended scope | High | Signature/state/nonce, expiry, audience, replay prevention and idempotency tests |
| DATA-01 | Sensitive documents are retrieved by a non-owner or unauthorised role | Critical | Server-side ownership and role checks; object-ID substitution tests |
| DATA-02 | Upload accepts malicious, oversized or mismatched content | High | Size/type/signature validation, safe storage and retrieval; adversarial file tests |
| AUDIT-01 | Privileged actor alters or deletes audit evidence | High | Append-only Worker writes, hash chaining, signed periodic checkpoints held outside primary admin control; tamper-detection tests |
| SUPPLY-01 | Committed secret or vulnerable dependency is used to compromise the application | Critical | Git-history secret scan, dependency/SCA scan, key rotation plan and CI gate |
| DEPLOY-01 | Builder or workflow changes production without independent approval | Critical | Protected branches, required independent review, CODEOWNERS, required checks and protected production environment |
| DEPLOY-02 | Change to a shared component unintentionally changes another portal | High | Impact map, explicit portal list, regression tests, staging approval and rollback evidence |
| EDGE-01 | Brute force, enumeration or denial-of-service overwhelms endpoints | High | Edge rate limits by IP and account/resource, abuse telemetry and bounded resource use |
| CONFIG-01 | Misconfigured Firebase API key, App Check or Worker binding weakens boundary | High | Read-only configuration audit; restrictions and App Check assessment; no config mutation without separate approval |
| REC-01 | Incident cannot be recovered because backups are absent or untested | Critical | Document actual export/backup path and free-tier constraints; tested restore and recovery objectives |

## 6. Measurable 95% target

The denominator is the approved scenario set in Section 5, weighted by severity: Critical = 5, High = 3, Medium = 2, Low = 1. For each scenario, evidence must demonstrate prevention or bounded containment under the documented preconditions. A scenario counts as passing only when an automated repeatable test or independently reviewable operational control exists.

`Weighted coverage = (weight of passing scenarios / total weight of in-scope scenarios) × 100`

Acceptance requires:
- Weighted coverage >= 95%.
- 100% of Critical scenarios pass.
- No unresolved Critical or High findings at release.
- All applicable negative tests pass, including unauthenticated, wrong-role, expired/replayed token, cross-portal and direct API invocation cases.
- Staging regression and recovery evidence is recorded.
- Residual risks, excluded scenarios and untested external controls are explicitly listed.

A passing percentage never overrides a single unresolved Critical finding.

## 7. Password-security remediation design (priority 0)

The current source review identifies two related weaknesses in the existing password-attempt flow: a caller can submit a failure report containing an arbitrary email without proof of an actual failed authentication event; and the client continues Firebase login if the supplementary password-security endpoint is unavailable.

Preferred architecture:
1. Move failure counting to a server-mediated authentication outcome where feasible, so the counter is incremented only after the credential authority confirms failure.
2. If a client report remains necessary, issue a short-lived, single-use, cryptographically verifiable challenge bound to the attempted account and attempt context; consume it once at the Worker. A client-supplied email alone is never proof.
3. Apply independent IP/device/network and account-level throttles at the edge and in the server-side state store.
4. Use progressive delay/backoff and bounded temporary restrictions, not an indefinite attacker-triggerable suspension. Provide a secure recovery/unlock path.
5. During Worker/state-store outage, use a deliberate bounded degraded mode or fail closed for affected password login. Do not silently bypass protection. Ensure outage behaviour cannot be used to deny all members service.
6. Keep user-facing errors generic enough to limit account enumeration.
7. Test correct password, wrong password, unknown account, repeated requests, forged proof, replay, concurrency, IP rotation, service outage, lock expiry, recovery and successful-login counter reset.

Do not implement a client-only fail-closed patch: it is not authoritative and may create an avoidable account-wide outage. No authentication change is authorised for production by this document.

## 8. MFA, recovery and break-glass

Define required MFA by role and action before enforcement. At minimum, privileged administrators, board approval roles and users able to publish externally or alter finance/procurement records require step-up assurance. Verify enrollment, factor change, device loss, recovery, session revocation and privileged action paths. Recovery must not be weaker than the control it replaces.

Break-glass access must be exceptional, time-bounded, individually attributable, require a reason and independent notification, create an audit event, and undergo post-incident review. It must not become a routine bypass for deployment or approval gates.

## 9. Audit integrity model

“Immutable” means tamper-evident and independently checkpointed, not mathematically impossible for a fully compromised owner to alter. Worker-generated events should include sequence, event ID, UTC timestamp, actor UID, verified role, action, resource, decision, request correlation ID and previous-event hash. Exclude passwords, tokens, secrets and unnecessary personal data.

Hash-chain records in a defined partition. Periodically sign a checkpoint and export it to a separately controlled append-only destination or repository. Verify the chain and checkpoint during audits. A Worker or storage credential compromise remains a residual risk until independent custody is implemented.

## 10. Change-control enforcement

Documentation alone is insufficient. Inspect and, only with separate repository-administration approval, configure:
- Main-branch protection/ruleset: pull requests only, independent approval, dismiss stale approvals, require approval of the latest push, required checks, no force push/deletion.
- CODEOWNERS for authentication, Firestore/Storage rules, Worker authorisation, deployment workflows and security controls.
- Prevent self-approval and direct pushes where GitHub plan and repository settings permit.
- Protected production GitHub Environment with independent reviewer(s), restricted deployment branches and minimum-scoped deployment credentials.
- Cloudflare deploy credentials restricted to the required Worker/environment and operations; no production token in general CI jobs.
- Preserve existing Firestore rules approval gate unchanged. PR #671 is outside this work and must not be edited or bypassed.

The feature branch is not authorised to alter repository settings or production credentials. Report current settings as verified/unverified; do not imply this document activates them.

## 11. Stage 1 evidence requirements

- Enumerate all Worker routes, HTTP methods, authentication middleware, role/resource checks and public exceptions.
- Enumerate all portals, roles, Firestore collections and Storage paths, external integrations, OAuth callbacks and webhooks.
- Run Firebase Rules Unit Testing against the Firebase Emulator for every collection/path, including unauthenticated, wrong-role, cross-portal, owner, authorised-role and admin cases. Inspect all matching rule clauses; catch-all deny alone is not proof.
- Scan current source and Git history for secrets using an approved scanner; never print detected secret values. Rotate only after owner approval and exposure validation.
- Inspect Firebase API key restrictions and App Check configuration read-only; record unknowns.
- Inspect MFA enforcement and account recovery paths.
- Inspect GitHub branch protection/rulesets, CODEOWNERS, required checks, protected environments and workflow permissions read-only.
- Confirm actual free-tier backup/export options and perform a restore rehearsal in an isolated environment before claiming recoverability.
- Review Worker edge controls and rate limits without changing production configuration.

## 12. Scope and release gates

This document and the assessment are source/design work only. No production or staging probing, production data access, Firestore/Storage rules edits, secret/config changes, account setting changes, merge, deployment, social publishing, or unrelated PR modification is authorised.

Any implementation touching an existing portal must identify exact routes/files/roles affected, preserve unrelated portals, include regression tests, pass isolated staging acceptance, provide rollback steps and receive the required owner release approval. Authentication remediation should be isolated in a separate reviewed PR after route and recovery-path analysis.

## 13. Recovery and free-tier limitations

Do not assume scheduled Firestore export is available on Firebase Spark. Record which data can be exported using supported free-tier mechanisms, export frequency and manual steps, encryption and custody, retention, RPO/RTO, and tested restoration. Back up Worker source/configuration and GitHub repository history separately. A backup is not accepted until a restore has been demonstrated.

## 14. Evidence status

| Area | Current status |
|---|---|
| Threat model and scenario register | Documented in this file |
| Password endpoint source concern | Source finding; runtime exploitability not tested |
| Client fail-open path | Source finding in `src/firebase/auth.js`; runtime outage behaviour not tested |
| Worker route inventory | In progress; not complete |
| Firebase rules emulator matrix | Not run |
| Git-history secret scan | Not run |
| Firebase API key restrictions/App Check | Not retrieved |
| MFA/recovery coverage | Not complete |
| GitHub branch protection / CODEOWNERS / protected environments | Not retrieved |
| Cloudflare edge controls | Not retrieved |
| Backup/restore rehearsal | Not run |
| Penetration testing | Not run |
| Production deployment | Not authorised or performed |

---
**Owner decision required before release:** approve the final scenario weights and residual-risk acceptance; separately approve any repository-administration changes, authentication-flow PR, secret rotation or production release.


## 15. Password-security service outage policy decision

**Design decision: fail closed for password-based sign-in when the mandatory Cloudflare password-security decision service is unavailable.** The current client behaviour that silently proceeds to Firebase password sign-in when the service fails is not acceptable as the target security policy.

Rationale:
- Silent fail-open removes the additional account-level protection precisely when its enforcement service is unhealthy.
- The client cannot provide a trustworthy fallback counter or challenge; a browser-side fallback is attacker-controlled.
- A server-independent fallback must be proven before it can be relied upon. Firebase's own abuse protections are useful defence-in-depth but are not treated as a substitute for the IRPA-specific policy.
- Existing authenticated sessions should not be forcibly terminated solely because the password-security service is unavailable.
- Alternate authentication routes may remain available only after their independence from the failed service, MFA coverage and server-side authorisation are verified. No such availability is assumed by this decision.

Operational safeguards required before implementation:
1. Return a clear temporary-unavailability message for password sign-in; do not expose internal service details.
2. Keep account recovery and administrator break-glass paths separately assessed so the outage does not create an informal bypass.
3. Alert and record the outage through an independent operational channel where available; do not rely solely on the failed Worker.
4. Restore password sign-in only after health checks pass; do not automatically clear lockout/failure state during recovery.
5. Test Worker outage, Durable Object/state-store failure, timeout, malformed response, partial outage, successful recovery and concurrent sign-in.
6. Measure availability impact and document an owner-approved recovery procedure before release.

**Decision status:** Architecture policy selected for the proposed remediation. Not implemented, not deployed and not yet approved as a production operational change. A separate owner release approval remains mandatory.

## 16. Verification record for the review follow-up

- The repository's `.github/CODEOWNERS` file assigns the wildcard and the listed sensitive paths to the same repository owner account. This does not establish independent review separation.
- The GitHub branch-protection endpoint returned HTTP 403 `Resource not accessible by integration`. Branch protection, required reviews, bypass actors and force-push restrictions are therefore **NOT VERIFIED**.
- The GitHub connector did not expose the repository Environments listing endpoint. Required reviewers and deployment-branch restrictions for the `production` environment are therefore **NOT VERIFIED**.
- The repository has Firebase Rules Unit Testing dependencies and two identified rule-test files: `tests/meeting-category-firestore-rules.test.cjs` and `tests/finance-portal-policy.test.cjs`. The package script `test:security-rules` runs those two files. This is targeted coverage, not proof of a complete collection-by-collection rules matrix.
- No emulator test was run in this review. The current tool session did not provide a repository checkout/runtime in which to install dependencies and execute the test suite.
- No Git-history secret scan was run. The GitHub connector does not provide a supported repository-history checkout or secret-scanning-alert read in this session. A source-text search is not a substitute for scanning all historical commits.
- The current `CODEOWNERS` file is present, but because the wildcard owner and sensitive-path owners are the same account, it does not demonstrate independent approval.
- No GitHub settings, Cloudflare configuration, Firebase project configuration, secrets, production data or Firestore rules were changed.
