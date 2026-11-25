# PCU governance operations

This extension adds tenant-scoped delegation proposals, configurable escalation policies, sequential approval workflow definitions, and operational dashboards.

## Delegations
A proposal requires a distinct delegator and delegate, explicit scopes, effective start/end timestamps and an evidence reference. New proposals are pending approval. They are governance records only and never grant Firebase claims, application permissions, financial authority or signature authority. Approval and lifecycle changes remain administrator-controlled and auditable.

## Escalation
Policies contain ordered elapsed-hour thresholds and distinct escalation actors. Thresholds must strictly increase. Runtime routing selects the highest reached threshold; disabling a policy suppresses routing. Escalation is an accountability and notification path, not an authorization grant.

## Approval workflows
Tenant-defined workflows contain ordered steps with explicit actor type and actor reference. Each step is distinct. An instance advances only when the actor assigned to the current step acts. Decisions are APPROVE, REJECT or RETURN. Existing separation-of-duties controls remain applicable to initiator, reviewer, recommender, approver, implementer and auditor.

## Dashboards
The performance view summarizes active assignments, completion rate, overdue items, acknowledgements, pending work, workflow outcomes and average decision cycle. The audit view groups immutable events by action, counts distinct actors and shows the latest 25 events. Dashboards reflect records available to the authenticated administrator; they do not manufacture missing performance evidence.

## Security and operational limits
All new records are scoped under `pcuTenants/{tenantId}`. Firestore rules require administrator authority for governance record writes, constrain delegation creation, prevent deletion, and keep audit events append-only. Duty assignments and delegations do not change app access. No personnel records are seeded or migrated.
