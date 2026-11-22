import test from"node:test";
import assert from"node:assert/strict";
import fs from"node:fs";
const source=fs.readFileSync(new URL("../src/pages/SignatureRecoveryOwnerPanel.jsx",import.meta.url),"utf8");
const queue=fs.readFileSync(new URL("../src/pages/SignatureRecoveryOwnerEnvelopes.jsx",import.meta.url),"utf8");
test("per-envelope assessment performs authenticated GET only",()=>{
 assert.match(source,/method:"GET"/);
 assert.doesNotMatch(source,/method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
});
test("owner recovery queue uses the Gateway queue and paginates",()=>{
 assert.match(queue,/api\/recovery\/envelopes\?limit=50&offset=/);
 assert.match(queue,/Load more/);
 assert.match(queue,/item\.envelopeId/);
});
test("assessment contains no signature or envelope persistence API",()=>{
 for(const forbidden of ["setDoc(","updateDoc(","deleteDoc(","addDoc(","writeBatch(","runTransaction(","reassignSigner(","retryFinalisation(","finalizeEnvelope(","completeEnvelope("])assert.equal(source.includes(forbidden),false);
});
test("assessment is explicitly read-only and has no recovery action",()=>{
 assert.match(source,/No retry, reassignment, repair or completion action is available/);
 assert.doesNotMatch(source,/\/stamps\/reassign|\/retry(?:\/|["'])|\/complete(?:\/|["'])|\/repair(?:\/|["'])/i);
});
