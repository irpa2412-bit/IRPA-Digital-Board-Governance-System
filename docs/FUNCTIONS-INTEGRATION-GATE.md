# Firebase Functions Integration Gate

## Purpose

This document records the isolated infrastructure gate that must be cleared before the central Authorization callable gateway is exported from `functions/index.js`.

## Verified blocker

The production-baseline Functions entrypoint contains an incomplete `resetTrialData` callable. Its implementation reaches the audit-record write and terminates at end-of-file without a closing implementation.

This causes:

```
SyntaxError: Unexpected end of input
```

Because `functions/index.js` is the shared Firebase Functions entrypoint, adding Authorization exports before repairing this defect would couple an unrelated infrastructure repair to the Authorization migration.

## Safe repair boundary

The repair branch is:

`repair/functions-entrypoint-integrity-2026-09-24`

The repair must:

1. Preserve every existing callable and trigger.
2. Determine the intended `resetTrialData` completion semantics from repository history/source evidence rather than inventing destructive behaviour.
3. Make the entrypoint syntactically valid.
4. Unit/syntax-test the complete entrypoint.
5. Test the repaired `resetTrialData` path independently without production data deletion.
6. Confirm the Authorization callables are still isolated until the entrypoint passes.
7. Only after independent validation, expose the Authorization callables and run a separate non-production callable test.

## Explicit safety rule

No production deployment, no live Authorization Grant/Revoke connection, and no trial-data deletion will be performed as part of this gate until the repair is independently verified.
