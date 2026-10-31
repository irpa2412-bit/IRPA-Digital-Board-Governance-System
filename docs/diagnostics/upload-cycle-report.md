# Upload initialization cycle diagnostic report

- Workflow run: https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/41238211090
- Commit: 82a15a76e243e11d0146c1516725d56f07ee400c
- Conclusion at report capture: cancelled

## GitHub Actions job summary

## Madge circular dependency output
- Finding files
Processed 157 files (1.5s) (3 warnings)

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
✔ legacy envelope with no envelope or source metadata is allowed (2.008128ms)
✔ matching envelope hash and size are accepted (0.225511ms)
✔ mismatching hash or size is blocked (0.153467ms)
✔ source document values are fallback when envelope values are absent (1.271352ms)
✔ envelope values take precedence over source document values (0.270024ms)
✔ Gateway accepts a legacy envelope when neither envelope nor source has expected metadata (1.664637ms)
✔ Gateway accepts a matching envelope hash and size (11.001742ms)
✔ Gateway blocks a mismatching expected hash or size (2.053062ms)
✔ upload runtime report preserves the first five stack lines for a thrown error (1.326746ms)
✔ upload dependency path no longer imports auth through the data module (5.121077ms)
[36mvite v7.3.7 [32mbuilding ssr environment for production...[36m[39m
transforming...
[32m✓[39m 4 modules transformed.
rendering chunks...
[2m../../../../../tmp/irpa-upload-runtime-L7apri/bundle/[22m[36msignatureStorage.js  [39m[1m[2m28.88 kB[22m[1m[22m[2m │ map: 46.95 kB[22m
[32m✓ built in 162ms[39m
✔ real built upload module completes Create Drive file against a mocked Gateway (238.027662ms)
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 451.623496

## Madge exit code
0
