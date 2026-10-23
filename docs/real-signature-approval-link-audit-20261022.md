# Real signature-to-approval link — read-only audit (2026-10-22)

**Audit base:** `integration/five-portal-chain-20261018` at `e3c35eb0d72e7c75b520215b4f8afcd682914297`.  
**Scope:** source inspection only. No source code, Worker code, Firestore rules, merge, or deployment changed.

## Evidence: items 1–5

1. **Signing entry points and records**
   - `src/pages/DocumentLifecycleModule.jsx:77` labels the action **Send to Signature** and only calls `transitionLifecycleDocument(documentId, "PENDING_SIGNATURE")`; lines 78 and 92 open `SignaturePlatform` with that document. `src/pages/SignaturePlatform.jsx:524-527,632` creates a **Draft Envelope** and calls `signEnvelope` when the user signs. `src/firebase/signaturePlatform.js:9,289,348` defines/writes `signatureEnvelopes`; it also writes `documents/{id}.signatureEnvelopeId` and `signatureStatus: "Draft"` at lines 289 and 348. `startSignatureWorkflow` is imported at `src/pages/SignaturePlatform.jsx:6`, but no call appears in that component; the exact UI action that activates the Gateway envelope is therefore **NOT RETRIEVED** from the two named pages.
   - `src/pages/GatewaySigningPortal.jsx:24-42,76-90` opens Gateway signing resources and submits signing actions. It calls `submitGatewaySignature`, then refreshes Gateway status and the signed PDF/evidence.
   - `src/firebase/signaturePlatform.js:296-325` bridges a Signature Platform workflow to the Gateway; `src/firebase/signatureStorage.js:401-473` uploads the PDF to the Gateway as a separate `DOC-${envelope.id}` document and creates a Gateway envelope with `externalReference: envelope.id`.
   - `drive-gateway/src/signing.mjs:4,6,53-58` stores and mutates the Gateway envelope under Worker metadata collection `envelopes`. Therefore the two names are distinct: Firebase mirror `signatureEnvelopes`; Gateway signing record `envelopes`.

2. **What completion writes**
   - Gateway sign handler: `drive-gateway/src/signing.mjs:56` records a signer as `Signed` and changes the envelope to `Completing` only when every Worker signer is `Signed`.
   - Gateway finalizer: `drive-gateway/src/signing.mjs:58` writes envelope `status: "Completed"` and `completion = { finalHash, fileName, completedAt, primaryStorageId, files, cryptographicEvidenceIds }`; `files` contains the stored archive/owner/signer copies.
   - Signature Platform Gateway bridge: `src/firebase/signaturePlatform.js:475-480` updates the Firebase `signatureEnvelopes/{id}` mirror (status, recipients, lastSignedByUid, signed-document URLs, hash/evidence metadata) and the per-signer `signatures/{id}` record.
   - On the Gateway path, `src/firebase/signaturePlatform.js:477` updates `documents/{id}` with `workflowActionStatus`, last workflow actor/time, completed-document URLs, `ownerRecordStatus`, and `lastCompletedDocumentHash`. It does **not** set document `status: "SIGNED"`, `signatureStatus: "COMPLETED"`, or `signedByUid` there.
   - The lifecycle completion handler, not the Gateway signing handler, writes those lifecycle fields: `drive-gateway/src/documentLifecycle.mjs:321-333` writes `status: "SIGNED"`, `signatureStatus: "COMPLETED"`, `signatureEnvelopeId`, `signedAt`, `signedByUid`, `signedDocumentUrl`, and `signedSourceFileId`.
   - `documents/{id}.signatureEnvelopeId` and `signatureStatus: "Draft"` are first written by `src/firebase/signaturePlatform.js:289,348`. No `signedByUid` write is present in `src/firebase/signaturePlatform.js`; the lifecycle handler is the observed writer.

3. **Approval/lifecycle readers and mismatch**
   - `drive-gateway/src/documentApproval.mjs:69-87` reads Firestore `documents/{id}`, then `document.signatureEnvelopeId || document.envelopeId`, then Firestore `signatureEnvelopes/{id}`; it requires the linked mirror's `documentId` to match and `status === "Completed"`. It uses `signedByUid` or envelope signer fields to prevent self-approval (lines 83-87).
   - `drive-gateway/src/documentApproval.mjs:90-117` writes `approval`, `approvalStatus`, and `approvalDecisionAt` plus an audit record.
   - `drive-gateway/src/documentLifecycle.mjs:321-333` reads `documents/{id}`, requires `status === "PENDING_SIGNATURE"`, then reads Firestore `signatureEnvelopes/{id}` and requires `status === "Completed"`; it writes the lifecycle completion fields listed above.
   - The Gateway canonical record is Worker `envelopes/{gatewayEnvelopeId}` (`drive-gateway/src/signing.mjs:4,6,58`), while approval/lifecycle currently read the Firestore mirror `signatureEnvelopes/{signatureEnvelopeId}`. The client mirror sync is `src/firebase/signaturePlatform.js:349-388`; Gateway signing invokes it from `src/pages/GatewaySigningPortal.jsx:57,71-73`. This is a client-triggered mirror, not the Worker completion record itself.
   - Gateway completion does not call `/api/document-lifecycle/signature-complete` from `src/pages/GatewaySigningPortal.jsx:76-94`; it submits and refreshes Gateway status. The lifecycle endpoint's required `PENDING_SIGNATURE` precondition is therefore not satisfied by the shown completion handler alone.

4. **Documents upload to signing prerequisites**
   - Lifecycle upload computes SHA-256, uploads the Drive file, and builds a Firestore record with `fileId`, `sha256`, and `status: "WORKING"`: `drive-gateway/src/documentLifecycle.mjs:202-225,247`; `drive-gateway/src/documentPolicy.mjs:61-67` defines that record.
   - Gateway signing creation requires its own metadata document to have `status === "Stored"`, `hash`, and a readable `primaryStorageId`: `drive-gateway/src/signing.mjs:53-55`.
   - A separate bridge exists for Signature Platform-selected PDFs: `src/firebase/signatureStorage.js:417-468` derives a new `DOC-${envelope.id}`, uploads the PDF via `/api/documents`, and creates the Gateway envelope. That does **not** preserve the lifecycle-upload record's document ID or convert its `WORKING/fileId/sha256` record into the Worker `Stored/hash/primaryStorageId` record. The existing lifecycle upload-to-Worker-record bridge is therefore **not present in the inspected handlers**.

5. **Multiple signers**
   - `src/pages/SignaturePlatform.jsx:520-522` supports multiple recipients and sequential/parallel routing.
   - `src/firebase/signatureStorage.js:406-468` filters action signers and passes the ordered signer list and routing mode to the Gateway.
   - `drive-gateway/src/signing.mjs:8,53-56` supports multiple signers; sequential eligibility checks signer order, and completion occurs only when every Worker signer has `status === "Signed"`.

## Proposed plan — awaiting approval

**Verdict: A — Worker `envelopes` is the signing source of truth; approval/lifecycle should adapt to verify the canonical Worker record.** The Firebase `signatureEnvelopes` document remains a linked UI/workflow mirror, not the completion authority. Link by the existing Firebase envelope's `gatewayEnvelopeId` and Worker `externalReference`; verify document linkage, status, hash, completion storage, and cryptographic evidence before approval/lifecycle updates.

### Smallest proposed changes (not yet authorized)

- `drive-gateway/src/documentApproval.mjs` — resolve the Firebase envelope link to the canonical Worker envelope; require verified completion/hash/evidence; retain officer-role, self-approval, duplicate-decision, and audit protections.
- `drive-gateway/src/documentLifecycle.mjs` — make `/signature-complete` verify the canonical Worker envelope and completed PDF, then atomically update the Firestore lifecycle record and audit fields. Add an explicit lifecycle-upload-to-Worker-document bridge only if required for the real upload path; recompute/verify bytes rather than aliasing `sha256` to `hash`.
- `drive-gateway/src/index.js` — wire the minimum authenticated adapter/dependencies needed by the approval/lifecycle handlers to read canonical Worker envelope state.
- `drive-gateway/src/signing.mjs` — only if the existing exported envelope/status helpers are insufficient, add a narrow read/verification helper. Do not duplicate the completion authority or weaken signer checks.
- `src/firebase/signaturePlatform.js` / `src/firebase/signatureStorage.js` — change only if needed to persist a stable, validated link between the existing Firebase envelope and Worker envelope/document. Avoid creating an unlinked duplicate document.
- **Worker files requiring separate approval:** every proposed change under `drive-gateway/src/` above. No Worker source has been changed.
- **Firestore rules:** no change is proposed in this plan. If emulator evidence proves a rule change is required, list each `firestore.rules` change as a separate approval item before editing; do not silently change rules.

### End-to-end test plan

Use the real application handlers and a Firestore emulator with isolated Worker metadata/storage; create all records through actual upload, envelope-creation, signing, completion, lifecycle, and approval requests—**no hand-seeded documents or envelopes**. Verify final PDF bytes/hash and completion files, then approve with a distinct authorized officer. Negative/bypass matrix: unauthenticated user; wrong owner/tenant/document link; missing or stale envelope link; non-Completed/Declined/Voided/CompletionFailed envelope; hash mismatch or missing primary storage/file; invalid/expired signing token; missing consent; unauthorized or inactive signer; signer UID mismatch; sequential out-of-order signing; parallel signing; duplicate signing/completion/retry; omitted required fields; view-only/optional signer; all-signers-not-yet-signed; unauthorized approver; signer attempting self-approval; duplicate approval; rejection without reason; already-transitioned/non-`PENDING_SIGNATURE` lifecycle document; failed audit commit; and lifecycle upload without a valid Worker Stored-record bridge. Assert denial is non-mutating and audit writes remain atomic.

### Migration risk and rollback

Existing records may be Firebase-only envelopes, Gateway-linked envelopes, or lifecycle-upload documents without a matching Worker `Stored/hash/primaryStorageId` record. Do not auto-migrate or infer links from titles/files. Classify existing records as linked, legacy-only, or incomplete; require explicit reconciliation for unmatched records; keep legacy reads available during staged rollout. Rollback: disable the new adapter/route behind a flag or revert the focused commit, restore the previous approval/lifecycle handlers, and leave existing records and files intact; no destructive migration or retroactive status rewrite.

### Staging acceptance with real test accounts

1. Use isolated staging Firebase/Firestore emulator configuration and non-production Worker storage; confirm project/endpoint pairing.
2. Create one test document through the Documents portal upload, then send it through the actual signing UI; verify a canonical Worker envelope and exact hash/storage link exist.
3. Sign as each real test signer using separate authenticated accounts; verify sequential/parallel behavior, completed PDF/hash/evidence, and mirror reconciliation.
4. Approve as a separate authorized officer; confirm self-approval and duplicate decisions are rejected; verify document lifecycle fields and audit trail.
5. Execute the full negative matrix above, inspect emulator records and Worker logs, and obtain human acceptance before any merge or deployment.

**State:** read-only audit complete; this is a draft plan only. No source code, Worker code, `firestore.rules`, merge, or deployment changed.
