# Signature hardening — verified state on main

Date: 2026-11-03
Repository: `irpa2412-bit/IRPA-Digital-Board-Governance-System`
Observed latest mainline commit from GitHub commit search: `859e649da7e4661b61bee3da89d28578e3ee8843` (merge PR #628). The branch search confirms a branch named `main`; a direct branch-ref SHA endpoint was not available through the connected GitHub operations, so this SHA is the latest commit-search result rather than an independently fetched refs API value.

## Frontend cryptographic signing flag

` .github/workflows/firebase-deploy.yml `:

```yaml
VITE_IRPA_CRYPTOGRAPHIC_SIGNING_ENABLED: "false"
```

The workflow also asserts:

```yaml
test "$VITE_IRPA_CRYPTOGRAPHIC_SIGNING_ENABLED" = "false"
```

The following other workflow files also set the flag to `false`:
- `.github/workflows/signature-palette-staging.yml`
- `.github/workflows/cloudflare-livekit-staging-frontend.yml`
- `.github/workflows/signature-palette-visibility.yml`

The repository-wide GitHub code search for this flag returned these four workflow files. The production frontend flag remains OFF. No workflow or build configuration was changed to enable it.

## Worker cryptographic settings

Retrieved from `drive-gateway/wrangler.toml` and `drive-gateway/src/esignContext.mjs`:

- Production Worker name: `irpa-google-drive-gateway`.
- Production environment marker: `IRPA_ENVIRONMENT = "production"`.
- Production e-sign module setting: `ESIGN_MODULE_ENABLED = "true"`.
- Production Drive mock setting: `DRIVE_MOCK = "false"`.
- Production Durable Object binding: `ESIGN_DO`, class `EsignRecordDurableObject`.
- The Worker context constructs `createCloudflareSignerKeyProvider(env)`.
- Key selection is per signer UID, using a dynamically derived binding name of the form `IRPA_CRYPTO_KEY_<SHA256-derived identifier>`.
- No secret values or key material were retrieved or printed.
- In staging and production, envelope finalization requires a key provider and cryptographic evidence for every signer.

## Interpretation

The frontend flag and Worker key custody are separate controls. The frontend flag is explicitly OFF in all four retrieved build workflows. The Worker source has a cryptographic key-provider integration and production/staging enforcement, but repository source alone does not prove that all production signer key bindings are provisioned or that isolated staging acceptance has passed.

No production deployment, secret change, Firestore rules change, or cryptographic flag change was performed.
