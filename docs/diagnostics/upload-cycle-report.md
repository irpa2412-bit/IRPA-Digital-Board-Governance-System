# Upload initialization cycle diagnostic report

- Workflow run: https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/41238185445
- Commit: c7121d6aa0a255d3863494fe67cc0b8bc9002cc9
- Conclusion at report capture: cancelled

## GitHub Actions job summary

## Madge circular dependency output
- Finding files
Processed 157 files (1.4s) (3 warnings)

✔ No circular dependency found!


## Import graph
{
  "components/ControlledDocumentUpload.jsx": [
    "components/controlledDocumentUploadValidation.mjs",
    "components/uploadRuntimeDiagnostics.mjs",
    "firebase/config.js",
    "firebase/data.js",
    "firebase/signatureStorage.js",
    "firebase/workflowLinks.js"
  ],
  "components/DocumentReader.jsx": [
    "firebase/config.js",
    "firebase/signatureStorage.js",
    "utils/documentIntegrity.mjs"
  ],
  "components/SignatureFieldConfirmationPad.jsx": [],
  "components/SignaturePathwaySelfTest.jsx": [
    "firebase/config.js",
    "firebase/signatureStorage.js"
  ],
  "components/controlledDocumentUploadValidation.mjs": [],
  "components/uploadRuntimeDiagnostics.mjs": [],
  "firebase/auth.js": [
    "firebase/auth.js",
    "firebase/config.js",
    "firebase/employeeRegistrationEmail.js",
    "firebase/functions.js",
    "firebase/gatewayUrl.js",
    "firebase/invitationWorkflow.js"
  ],
  "firebase/config.js": [
    "firebase/auth.js"
  ],
  "firebase/data.js": [
    "firebase/config.js",
    "firebase/documentLifecycle.js",
    "firebase/employeeRegistrationEmail.js",
    "firebase/functions.js",
    "firebase/gatewayUrl.js",
    "firebase/meetingPolicy.js",
    "firebase/registeredIdentityReconciliation.js"
  ],
  "firebase/documentLifecycle.js": [
    "firebase/auth.js",
    "firebase/config.js",
    "firebase/gatewayUrl.js"
  ],
  "firebase/employeeRegistrationEmail.js": [
    "firebase/config.js",
    "firebase/gatewayUrl.js"
  ],
  "firebase/functions.js": [
    "firebase/auth.js",
    "firebase/config.js",
    "firebase/functions.js",
    "firebase/registeredIdentityReconciliation.js"
  ],
  "firebase/gatewayUrl.js": [],
  "firebase/invitationWorkflow.js": [
    "firebase/config.js",
    "firebase/data.js"
  ],
  "firebase/meetingPolicy.js": [],
  "firebase/registeredIdentityReconciliation.js": [
    "firebase/config.js",
    "firebase/gatewayUrl.js"
  ],
  "firebase/signaturePlatform.js": [
    "firebase/config.js",
    "firebase/data.js",
    "firebase/gatewayUrl.js",
    "firebase/signatureStorage.js",
    "firebase/signatureWorkflowPolicy.js",
    "firebase/signerIdentity.js",
    "firebase/workflowLinks.js"
  ],
  "firebase/signatureStorage.js": [
    "firebase/auth.js",
    "firebase/config.js",
    "firebase/gatewayUrl.js"
  ],
  "firebase/signatureWorkflowPolicy.js": [],
  "firebase/signerIdentity.js": [
    "firebase/config.js",
    "firebase/gatewayUrl.js"
  ],
  "firebase/workflowLinks.js": [
    "firebase/config.js"
  ],
  "pages/SignaturePlatform.jsx": [
    "components/ControlledDocumentUpload.jsx",
    "components/SignatureFieldConfirmationPad.jsx",
    "components/SignaturePathwaySelfTest.jsx",
    "firebase/config.js",
    "firebase/data.js",
    "firebase/signaturePlatform.js",
    "firebase/signatureStorage.js",
    "firebase/signerIdentity.js",
    "firebase/workflowLinks.js",
    "utils/documentIntegrity.mjs"
  ],
  "utils/documentIntegrity.mjs": []
}

## Vite build output
Build output unavailable.

## Create Drive file runtime result
Runtime result unavailable.

## Workflow diagnostic console

## Regression test output
✔ legacy envelope with no envelope or source metadata is allowed (2.26678ms)
✔ matching envelope hash and size are accepted (0.256576ms)
✔ mismatching hash or size is blocked (0.204022ms)
✔ source document values are fallback when envelope values are absent (1.3022ms)
✔ envelope values take precedence over source document values (0.352269ms)
node:internal/modules/cjs/loader:1564
  const err = new Error(message);
              ^

Error: Cannot find module './syntax/CharCodes'
Require stack:
- /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/node_modules/pdf-lib/cjs/core/index.js
    at Module._resolveFilename (node:internal/modules/cjs/loader:1564:15)
    at wrapResolveFilename (node:internal/modules/cjs/loader:1118:27)
    at defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1142:10)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1169:12)
    at Module._load (node:internal/modules/cjs/loader:1341:5)
    at wrapModuleLoad (node:internal/modules/cjs/loader:261:19)
    at Module.require (node:internal/modules/cjs/loader:1674:12)
    at require (node:internal/modules/helpers:157:16)
    at Object.<anonymous> (/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/node_modules/pdf-lib/cjs/core/index.js:5:19)
    at Module._compile (node:internal/modules/cjs/loader:1929:14) {
  code: 'MODULE_NOT_FOUND',
  requireStack: [
    '/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/node_modules/pdf-lib/cjs/core/index.js'
  ]
}

Node.js v24.22.1
✖ tests/gateway-signing-integrity.test.mjs (112.185163ms)
✔ upload runtime report preserves the first five stack lines for a thrown error (1.025266ms)
✔ upload dependency path no longer imports auth through the data module (7.972013ms)
[36mvite v7.3.6 [32mbuilding ssr environment for production...[36m[39m
transforming...
[32m✓[39m 4 modules transformed.
rendering chunks...
[2m../../../../../tmp/irpa-upload-runtime-O5KygS/bundle/[22m[36msignatureStorage.js  [39m[1m[2m28.88 kB[22m[1m[22m[2m │ map: 46.95 kB[22m
[32m✓ built in 174ms[39m
✔ real built upload module completes Create Drive file against a mocked Gateway (236.061044ms)
ℹ tests 9
ℹ suites 0
ℹ pass 8
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 449.863454

✖ failing tests:

test at tests/gateway-signing-integrity.test.mjs:1:1
✖ tests/gateway-signing-integrity.test.mjs (112.185163ms)
  'test failed'

## Madge exit code
0
