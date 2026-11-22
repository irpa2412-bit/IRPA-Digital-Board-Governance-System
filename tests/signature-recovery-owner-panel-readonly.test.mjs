import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/pages/SignatureRecoveryOwnerPanel.jsx", import.meta.url), "utf8");

test("owner recovery panel performs only authenticated GET requests", () => {
  assert.match(source, /fetch\(gateway\+path,\{method:"GET"/);
  assert.doesNotMatch(source, /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
  assert.doesNotMatch(source, /fetch\([^\n]*method\s*:\s*(?!["']GET["'])/i);
});

test("owner recovery panel exposes only queue, evidence and non-authoritative preview reads", () => {
  assert.match(source, /\/api\/recovery\/envelopes\?limit=50&offset=/);
  assert.match(source, /\/api\/recovery\/envelopes\//);
  assert.match(source, /\/evidence/);
  assert.match(source, /\/preview\.pdf/);
  assert.doesNotMatch(source, /\/stamps\/reassign|\/retry(?:\/|["'])|\/complete(?:\/|["'])|\/repair(?:\/|["'])|\/send-link/i);
});

test("owner recovery panel contains no signature or envelope persistence API", () => {
  for (const forbidden of [
    "setDoc(", "updateDoc(", "deleteDoc(", "addDoc(", "writeBatch(",
    "runTransaction(", "signDocument(", "reassignSigner(", "retryFinalisation(",
    "finalizeEnvelope(", "completeEnvelope("
  ]) assert.equal(source.includes(forbidden), false, "Unexpected persistence/action API: " + forbidden);
});

test("owner recovery panel cannot directly change envelope completion state", () => {
  assert.doesNotMatch(source, /\.status\s*=\s*["']Completed["']/);
  assert.doesNotMatch(source, /status\s*:\s*["']Completed["']/);
  assert.match(source, /All assessment and preview requests from this screen use GET/);
});

test("owner recovery panel distinguishes a missing evidence route from authentication and ownership failures",()=>{
  assert.match(source,/EVIDENCE_ROUTE_MISSING/);
  assert.match(source,/The recovery service is unavailable \\(route missing\\)/);
  assert.match(source,/AUTH_REQUIRED/);
  assert.match(source,/OWNER_FORBIDDEN/);
});

test("owner recovery panel displays partial evidence and provides copy and text download",()=>{
  for(const value of ["auditChain","sourceHashStatus","stampSlots","finalisationStage","Copy report","Download plain-text report","Preview: not available because"])assert.ok(source.includes(value),"Missing partial evidence/report feature: "+value);
});

test("owner recovery panel sends queue, evidence and preview reads only",()=>{
  assert.match(source,/method:"GET"/);
  assert.match(source,/\/api\/recovery\/envelopes\//);
  assert.match(source,/\/evidence/);
  assert.match(source,/\/preview\.pdf/);
  assert.doesNotMatch(source,/method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
});