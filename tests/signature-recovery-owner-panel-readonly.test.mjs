import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const source=fs.readFileSync(new URL("../src/pages/SignatureRecoveryOwnerPanel.jsx",import.meta.url),"utf8");
const queue=fs.readFileSync(new URL("../src/pages/SignatureRecoveryOwnerEnvelopes.jsx",import.meta.url),"utf8");
test("each selected owner envelope exposes authenticated evidence, dry-run diagnosis and safe preview",()=>{
 assert.match(source,/\/api\/recovery\/envelopes\//);
 assert.match(source,/\/evidence/);
 assert.match(source,/diagnose-finalisation/);
 assert.match(source,/\/preview\.pdf/);
 assert.match(source,/normalizeFinalisationDiagnostic\(raw\)/);
 assert.match(source,/normalized\.readOnly!==true/);
});
test("evidence and preview remain GET while diagnosis and controlled retry actions use POST",()=>{
 assert.match(source,/recoveryRequest\([^;]*diagnose-finalisation[^;]*method:"POST"/s);
 assert.match(source,/retry-finalisation/);
 assert.match(source,/confirmOneRetry:true/);
 assert.match(source,/undo-finalisation-retry/);
 assert.match(source,/recoveryRequest\([^;]*evidence/);
 assert.match(source,/recoveryRequest\([^;]*preview\.pdf/);
 assert.doesNotMatch(source,/method\s*:\s*["'](?:PUT|PATCH|DELETE)["']/i);
});
test("preview is gated by failed status, verified audit chain and verified source hash",()=>{
 assert.match(source,/canPreview=.*CompletionFailed/);
 assert.match(source,/auditChain\?\.status==="VERIFIED"/);
 assert.match(source,/sourceHashStatus==="VERIFIED"/);
 assert.match(source,/RECOVERY PREVIEW — NOT COMPLETED/);
});
test("owner queue is paginated and lists all non-completed owner envelopes",()=>{
 assert.match(queue,/api\/recovery\/envelopes\?limit=50&offset=/);
 assert.match(queue,/Load more/);
 assert.match(queue,/item\.envelopeId/);
 assert.match(queue,/Every non-completed envelope you own/);
});
test("recovery UI exposes only a manually confirmed single retry and failed-retry undo",()=>{
 assert.match(source,/I approve exactly one normal finalisation attempt/);
 assert.match(source,/retryApproved/);
 assert.match(source,/diagnostic\?\.readOnly===true/);
 assert.match(source,/Retry finalisation/);
 assert.match(source,/Undo failed retry/);
 assert.match(source,/Download evidence report/);
 assert.match(source,/maskedAddress/);
 assert.match(source,/signedAtEAT/);
 assert.match(source,/signatures verified; completed PDF not yet generated/);
 for(const forbidden of ["updateDoc(","deleteDoc(","addDoc(","writeBatch(","runTransaction(","signDocument(","reassignSigner(","finalizeEnvelope(","completeEnvelope("])assert.equal(source.includes(forbidden),false,forbidden);
 assert.doesNotMatch(source,/\/stamps\/reassign|\/complete(?:\/|["'])|\/repair(?:\/|["'])|\/send-link/i);
});
test("diagnostic UI explicitly confirms dry-run does not write or modify original evidence",()=>{
 assert.match(source,/No envelope, signer, field, signature, hash, certificate, archive, Drive or email writes were performed/);
 assert.match(source,/This diagnostic does not retry, reassign, repair or finalise the envelope/);
});
