# IRPA-DGBS Controlled System Reset Protocol

## Purpose

The Controlled System Reset is an emergency/recovery control for IRPA-DGBS. It is separate from ordinary trial-data reset controls.

## Create and activate the developer authorization

1. From the repository root, run `node scripts/generate-reset-authorization-key.js` in a trusted developer workstation. It generates a cryptographically random 384-bit authorization and prints it once; it does not write the value to a file.
2. Store that exact value in Firebase Secret Manager under `IRPA_RESET_DEVELOPER_SECRET` using the Firebase Functions secret workflow. Do not place the value in GitHub secrets, source code, `.env`, client configuration, or logs.
3. Deploy the Functions that bind `IRPA_RESET_DEVELOPER_SECRET` (`requestDataReset`, `cancelDataReset`, `executeDataReset`, and `getDataResetStatus`) to the intended Firebase project.
4. Verify the secret is available to the deployed Functions without printing its value. Only then hand the value to the authorized IRPA Administrator over a separate trusted channel.
5. If the value is exposed, rotate it immediately in Secret Manager and redeploy the bound Functions. Do not reuse the compromised value.

The generator only creates the authorization value. It does not provision cloud secrets or deploy production services. Do not represent the key as active until steps 2–4 are complete.

## Security model

1. An authenticated IRPA Administrator creates a reset plan.
2. The Administrator supplies the developer-issued authorization out-of-band.
3. The authorization is held only in Firebase Secret Manager as `IRPA_RESET_DEVELOPER_SECRET`.
4. The authorization is never hard-coded, returned by the application, or written into audit records.
5. A reset plan enters `PENDING_GRACE`.
6. The grace period is at least 30 minutes and can be extended to 1 hour, 2 hours, or 24 hours.
7. The scheduling Administrator can cancel the plan during the grace period.
8. Execution is rejected until the grace period expires and is restricted to the scheduling Administrator.
9. Scheduling, cancellation, and execution create server-side audit events.
10. Authorization comparisons use a constant-time comparison for equal-length values.

## Reset scopes

### `TRIAL_ONLY`

Deletes only records explicitly marked as trial data by `recordOrigin=TRIAL`, `trialData=true`, or `isTrial=true`.

### `SELECTED_DATA`

Deletes all records in the selected resettable collections. This is destructive and must be used only for a deliberately authorized system reset.

## Protected data

The reset service cannot select or bulk-delete audit records, administrator profiles, reset plans, system settings, invitations, registration requests, induction records, member/employee counters, signature profiles/envelopes/events/signer identities, notifications/mail, or financial reference counters. It does not revoke Firebase Authentication accounts or administrator claims.

## Operational rule

Never execute a destructive reset merely to test the interface. Use `TRIAL_ONLY` with clearly marked test records first. Treat any secret rotation as invalidating prior administrator sessions; re-enter the new authorization after deployment.
