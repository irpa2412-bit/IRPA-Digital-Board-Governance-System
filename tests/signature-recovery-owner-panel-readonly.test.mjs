import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const source=fs.readFileSync(new URL("../src/pages/SignatureRecoveryOwnerPanel.jsx",import.meta.url),"utf8");
test("owner recovery panel keeps assessment reads and limits POST to the diagnostic endpoint",()=>{
 assert.match(source,/fetch\(gateway\+path,\{method,headers/);
 assert.match(source,/method==="POST"\?\{body:"\\{\\}"\}:\{\}/);
 assert.match(source,/diagnose-finalisation/);
 assert.match(source,/DIAGNOSTIC_RESPONSE_INVALID/);
 assert.match(source,/normalizeFinalisationDiagnostic/);
 assert.doesNotMatch(source,/method\s*:\s*["'](?:PUT|PATCH|DELETE)["']/i);
});
test("owner recovery panel keeps queue, evidence and preview reads",()=>{
 for(const value of ["/api/recovery/envelopes?limit=50&offset=","/evidence","/preview.pdf","Copy report","Download plain-text report"])assert.ok(source.includes(value));
});
test("owner recovery panel does not expose retry, reassignment or completion mutations",()=>{
 for(const forbidden of ["updateDoc(","deleteDoc(","addDoc(","writeBatch(","runTransaction(","signDocument(","reassignSigner(","retryFinalisation(","finalizeEnvelope(","completeEnvelope("])assert.equal(source.includes(forbidden),false,forbidden);
 assert.doesNotMatch(source,/\/stamps\/reassign|\/retry(?:\/|["'])|\/complete(?:\/|["'])|\/repair(?:\/|["'])|\/send-link/i);
});
test("diagnostic UI states the operation is a no-write sandbox and supports copying",()=>{
 assert.match(source,/Diagnose finalisation/);
 assert.match(source,/Copy report/);
 assert.match(source,/No envelope, signer, field, signature, hash, certificate, archive, Drive file or email record is changed by diagnosis/);
});
test("diagnostic response handling fails closed for malformed payloads without unguarded property access",()=>{
 assert.match(source,/normalizeFinalisationDiagnostic\(raw\)/);
 assert.match(source,/catch\(err\)/);
});
