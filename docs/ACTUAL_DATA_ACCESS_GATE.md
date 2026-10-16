# Actual-Data Entry Gate

## Default state
Actual operational data entry is closed when `systemSettings/actualDataAccess` is absent or `enabled` is not exactly `true`. Do not create this setting manually or enable it through the Firestore client SDK.

## Opening access
Only an authenticated, active IRPA Administrator can call `setActualDataAccess`. Opening requires the exact attestation `I CONFIRM FINAL SYSTEM TESTS PASSED`. The callable records the actor, timestamp, version, final-test attestation and an audit event. Closing access is always available to the administrator and is audited.

The Settings control is visible only in the administrator's Settings view. It is not a deployment-time auto-open and it remains closed by default. The attestation is an administrator declaration; it does not replace the final system-test evidence or CI checks.

## Entry behavior
- While closed, the portal entry gate disables ACTUAL for ordinary operational data categories. If gate status cannot be retrieved, it fails closed.
- Existing role-specific authorization remains in force after opening; this gate does not grant new roles or approvals.
- Firestore rules gate create, update and delete operations in the designated operational collections. Actual/unmarked writes require the server-controlled gate to be open.
- Trial writes remain possible only when the record is explicitly marked with `recordOrigin: "TRIAL"`, `trialData: true`, or `isTrial: true`, and the existing collection-specific role rules permit the operation.
- Client SDK writes to `systemSettings/actualDataAccess` are denied, so the attestation cannot be bypassed by directly editing the setting.
- Registered member/employee identity profiles, administrator profiles, signer/signature profiles, auditor profiles, invitations and security configuration are not treated as operational actual-data records by this gate. Existing profile-deletion restrictions continue to apply.

## Verification required before opening
1. All required CI checks are green.
2. Authenticated staging tests confirm a non-admin cannot open the gate.
3. With the gate closed, actual/unmarked operational writes are denied.
4. Trial-marked writes still follow existing role controls and trial workflows.
5. An administrator can open only with the exact final-test attestation; audit records identify the administrator.
6. Once open, members and employees can create permitted actual operational records under their existing role permissions.
7. The administrator can close the gate again and actual/unmarked operational writes are denied.
