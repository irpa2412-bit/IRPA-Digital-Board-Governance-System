# IRPA-DGBS Controlled System Reset Protocol

## Purpose

The Controlled System Reset is an emergency/recovery control for IRPA-DGBS. It is deliberately separate from ordinary trial-data reset controls.

## Security model

1. An authenticated IRPA Administrator creates a reset plan.
2. The Administrator must supply the reset authorization issued out-of-band by the reset developer.
3. The authorization is stored only as a Firebase Secret Manager secret named `IRPA_RESET_DEVELOPER_SECRET`.
4. The authorization is never hard-coded in the repository, displayed back by the application, or written into the audit record.
5. A reset plan enters `PENDING_GRACE`.
6. The grace period is at least 30 minutes and can be extended to 1 hour, 2 hours, or 24 hours from the Administrator interface.
7. The scheduling Administrator can cancel the plan during the grace period.
8. Execution is rejected until the grace period has expired.
9. Execution is restricted to the Administrator who scheduled the plan.
10. Every schedule, cancellation and execution creates a server-side audit event.

## Reset scopes

### TRIAL_ONLY

Deletes only records explicitly marked as trial data by `recordOrigin=TRIAL`, `trialData=true`, or `isTrial=true`.

### SELECTED_DATA

Deletes all records in the selected resettable collections.

This scope is destructive and must be used only for a deliberately authorized system reset.

## Protected data

The reset service cannot select or bulk-delete:

- `audit`
- `adminProfiles`
- `systemResetPlans`
- `systemSettings`
- `invitations`
- `registrationRequests`
- `inductionRecords`
- member/employee counters
- signature profiles, envelopes, events and signer identities
- notifications and mail
- financial reference counters

Most importantly, the reset service does not revoke Firebase Authentication accounts or administrator claims.

## Developer handoff

The reset developer should create/rotate the Firebase Secret Manager secret:

`IRPA_RESET_DEVELOPER_SECRET`

The actual secret value must be communicated to an authorized IRPA Administrator through a separate trusted channel. It must not be committed to GitHub, placed in source code, or entered into an ordinary configuration file.

After changing the secret, existing reset sessions should be treated as invalid and the Administrator should re-enter the new authorization.

## Operational rule

Do not execute a destructive reset simply to test the interface. Use `TRIAL_ONLY` with clearly marked test records first.

The existing Firebase production environment, administrator continuity controls and security/audit records are intentionally outside the bulk-reset scope.
