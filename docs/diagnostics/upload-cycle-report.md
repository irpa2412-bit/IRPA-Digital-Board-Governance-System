# Upload initialization cycle diagnostic report

- Workflow run: https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/41238862847
- Commit: c3962b313875e3eb8e746fc22d4c545662f11793
- Conclusion at report capture: failure

## GitHub Actions job summary

## Madge circular dependency output
- Finding files
Processed 157 files (935ms) (3 warnings)

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
✔ legacy envelope with no envelope or source metadata is allowed (1.349572ms)
✔ matching envelope hash and size are accepted (0.171657ms)
✔ mismatching hash or size is blocked (0.115844ms)
✔ source document values are fallback when envelope values are absent (1.202903ms)
✔ envelope values take precedence over source document values (0.145308ms)
✔ Gateway accepts a legacy envelope when neither envelope nor source has expected metadata (0.926469ms)
✔ Gateway accepts a matching envelope hash and size (5.961856ms)
✔ Gateway blocks a mismatching expected hash or size (0.997786ms)
✔ upload runtime report preserves the first five stack lines for a thrown error (0.69388ms)
✔ upload dependency path no longer imports auth through the data module (3.295971ms)
[36mvite v7.3.7 [32mbuilding ssr environment for production...[36m[39m
transforming...
[32m✓[39m 4 modules transformed.
rendering chunks...
[2m../../../../../tmp/irpa-upload-runtime-FgwyB6/bundle/[22m[36msignatureStorage.js  [39m[1m[2m28.88 kB[22m[1m[22m[2m │ map: 46.95 kB[22m
[32m✓ built in 96ms[39m
✔ real built upload module completes Create Drive file against a mocked Gateway (148.538435ms)
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 284.445381

## Madge exit code
0
