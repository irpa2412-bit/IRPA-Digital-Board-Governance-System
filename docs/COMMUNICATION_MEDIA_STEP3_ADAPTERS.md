# Social adapters (step 3)

The provider manifest is deliberately fail-closed. Credentials being present is not a connected/verified account. Until each platform has a verified OAuth grant, permitted scopes, account identity, expiry tracking, media upload implementation and API approval, it must return `automaticPublishing: false`.

Required Worker secret names are reported as missing names only; never return values. All channels support a ready-to-paste manual export, with platform text limits checked before export. Retries must be bounded, idempotency-aware, and limited to transient failures; do not retry authorization, validation, or policy-gate failures. Every attempted publish must append a visible outcome record without token values.

Platform-specific media processing and live publish APIs remain disabled behind feature flags until separately verified.
